import 'server-only';

import { getDb } from '@/config/supabase';
import {
  messageMyTrips,
  messageT5Condition,
  messageT5Done,
  messageT5Note,
  messageT5Odometer,
  messageT5TooLow,
} from '@/lib/bots/telegramMessages';

import { notifyAhoOdometerTooLow, notifyAhoRemark } from './notifyReturn';

import type { DriverTripLine } from '@/lib/bots/telegramMessages';
import type { InlineButton } from '@/lib/bots/telegram';

/**
 * Возврат, который оформляет водитель в Telegram (Т5).
 *
 * Шаг разговора не хранится отдельно: он выводится из самой поездки. Одометра
 * нет — спрашиваем одометр; есть одометр, но нет оценки состояния — спрашиваем
 * состояние; есть оценка, но нет отметки о завершении — спрашиваем примечание.
 *
 * Так сделано намеренно. Отдельная таблица состояний разошлась бы с поездкой
 * при любом сбое: водитель ответил, запись о шаге не легла — и бот заново
 * спрашивает то, что уже знает. Здесь источник правды один.
 */

/** Отметка о завершении разговора. Пустое примечание от незаданного вопроса. */
const DONE_EVENT = 'driver_return_completed';

export interface DriverTripRow {
  id: number;
  route: string;
  starts_at: string;
  ends_at: string;
  status: string;
  driver_confirmation: string;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  condition_ok: boolean | null;
  car_id: string | null;
  cars: { plate: string; model: string } | null;
  employees: { display_name: string } | null;
}

const SELECT =
  'id, route, starts_at, ends_at, status, driver_confirmation, odometer_start_km, ' +
  'odometer_end_km, condition_ok, car_id, cars(plate, model), ' +
  'employees!trips_author_id_fkey(display_name)';

export type ReturnStep = 'odometer' | 'condition' | 'note' | 'done';

/** Реплика бота: текст и, если нужно, кнопки под ним. */
export interface BotReply {
  text: string;
  buttons?: InlineButton[];
  /** Кнопки сеткой: сетка календаря водителя. */
  rows?: InlineButton[][];
  /** Показать постоянные кнопки под полем ввода. */
  withKeyboard?: boolean;
}

/** Поездка водителя, которая сейчас в пути. */
async function activeTrip(driverId: string): Promise<DriverTripRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('driver_id', driverId)
    .eq('status', 'in_trip')
    .order('ends_at')
    .limit(1)
    .maybeSingle<DriverTripRow>();

  if (error) {
    throw new Error(`Не удалось найти поездку водителя: ${error.message}`);
  }
  return data;
}

async function isCompleted(tripId: number): Promise<boolean> {
  const { data, error } = await getDb()
    .from('trip_events')
    .select('trip_id')
    .eq('trip_id', tripId)
    .eq('kind', DONE_EVENT)
    .returns<{ trip_id: number }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать отметку о возврате`, error);
    return false;
  }
  return (data ?? []).length > 0;
}

export async function returnStep(trip: DriverTripRow): Promise<ReturnStep> {
  if (trip.odometer_end_km === null) {
    return 'odometer';
  }
  if (trip.condition_ok === null) {
    return 'condition';
  }
  return (await isCompleted(trip.id)) ? 'done' : 'note';
}

const CONDITION_BUTTONS: InlineButton[] = [
  { text: 'Да', data: 'cond:ok' },
  { text: 'Есть замечание', data: 'cond:remark' },
];

const SKIP_BUTTON: InlineButton[] = [{ text: 'Пропустить', data: 'note:skip' }];

/** Вопрос, соответствующий текущему шагу. */
function prompt(trip: DriverTripRow, step: ReturnStep): BotReply {
  switch (step) {
    case 'odometer':
      return {
        text: messageT5Odometer(
          trip.id,
          trip.route,
          trip.odometer_start_km ?? 0,
          trip.employees?.display_name ?? null,
        ),
      };
    case 'condition':
      return {
        text: messageT5Condition(
          trip.odometer_end_km ?? 0,
          (trip.odometer_end_km ?? 0) - (trip.odometer_start_km ?? 0),
        ),
        buttons: CONDITION_BUTTONS,
      };
    case 'note':
      return {
        text: messageT5Note(trip.condition_ok !== false),
        buttons: trip.condition_ok !== false ? SKIP_BUTTON : undefined,
      };
    case 'done':
      return { text: messageT5Done(false) };
  }
}

/**
 * Начать или продолжить возврат. Вызывается кнопкой «Мои поездки» и
 * планировщиком в плановое время возврата.
 */
export async function askReturnStep(driverId: string): Promise<BotReply | null> {
  const trip = await activeTrip(driverId);

  if (!trip) {
    return null;
  }

  const step = await returnStep(trip);

  if (step === 'done') {
    return {
      text: 'Показания я уже записал. Осталось сдать ключи на рецепции.',
    };
  }

  return prompt(trip, step);
}

/** Показание одометра, присланное текстом. */
export async function acceptOdometer(
  driverId: string,
  digits: string,
): Promise<BotReply | null> {
  const trip = await activeTrip(driverId);

  if (!trip || (await returnStep(trip)) !== 'odometer') {
    return null;
  }

  const value = Number(digits);
  const start = trip.odometer_start_km ?? 0;

  if (value < start) {
    await notifyAhoOdometerTooLow(trip.id, value, { driverId });
    return { text: messageT5TooLow(start) };
  }

  const db = getDb();

  const { error } = await db
    .from('trips')
    .update({ odometer_end_km: value, updated_at: new Date().toISOString() })
    .eq('id', trip.id)
    .eq('status', 'in_trip');

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось записать одометр водителя`, error);
    return { text: 'Не получилось записать. Попробуйте отправить число ещё раз.' };
  }

  const { error: readingError } = await db.from('odometer_readings').insert({
    trip_id: trip.id,
    car_id: trip.car_id,
    kind: 'return',
    value_km: value,
    entered_by_driver: driverId,
  });

  if (readingError) {
    console.error(`Поездка #${trip.id}: показание не попало в историю`, readingError);
  }

  return {
    text: messageT5Condition(value, value - start),
    buttons: CONDITION_BUTTONS,
  };
}

/** Ответ на «Всё в порядке с машиной?». */
export async function acceptCondition(
  driverId: string,
  conditionOk: boolean,
): Promise<BotReply | null> {
  const trip = await activeTrip(driverId);

  if (!trip || (await returnStep(trip)) !== 'condition') {
    return null;
  }

  const { error } = await getDb()
    .from('trips')
    .update({ condition_ok: conditionOk, updated_at: new Date().toISOString() })
    .eq('id', trip.id)
    .eq('status', 'in_trip');

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось записать состояние`, error);
    return { text: 'Не получилось записать. Нажмите кнопку ещё раз.' };
  }

  return {
    text: messageT5Note(conditionOk),
    buttons: conditionOk ? SKIP_BUTTON : undefined,
  };
}

/**
 * Примечание — текстом или пропуском. Это последний шаг: здесь ставится
 * отметка о завершении и уходит К10, если есть что передать в АХО.
 */
export async function acceptNote(driverId: string, note: string): Promise<BotReply | null> {
  const trip = await activeTrip(driverId);

  if (!trip || (await returnStep(trip)) !== 'note') {
    return null;
  }

  const db = getDb();
  const trimmed = note.trim();

  if (trimmed) {
    const { error } = await db
      .from('trips')
      .update({ return_note: trimmed, updated_at: new Date().toISOString() })
      .eq('id', trip.id)
      .eq('status', 'in_trip');

    if (error) {
      console.error(`Поездка #${trip.id}: не удалось записать примечание`, error);
      return { text: 'Не получилось записать. Напишите ещё раз.' };
    }
  }

  const { error: eventError } = await db.from('trip_events').insert({
    trip_id: trip.id,
    kind: DONE_EVENT,
    payload: { has_note: Boolean(trimmed), condition_ok: trip.condition_ok },
    actor_driver: driverId,
  });

  if (eventError) {
    // Без отметки бот спросит примечание снова. Неприятно, но не страшно:
    // повторный ответ просто перезапишет текст.
    console.error(`Поездка #${trip.id}: отметка о завершении не записана`, eventError);
  }

  // К10 уходит и на замечание, и на примечание: АХО решает, что делать.
  if (trip.condition_ok === false || trimmed) {
    await notifyAhoRemark(trip.id);
  }

  return { text: messageT5Done(Boolean(trimmed)) };
}

/** Кнопка «Мои поездки»: что сейчас за водителем. */
export async function listDriverTrips(driverId: string): Promise<BotReply> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('driver_id', driverId)
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .order('starts_at')
    .returns<DriverTripRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать поездки водителя: ${error.message}`);
  }

  const trips = data ?? [];

  const lines: DriverTripLine[] = trips.map((trip) => ({
    tripId: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    status:
      trip.status === 'in_trip'
        ? 'в пути'
        : trip.driver_confirmation === 'confirmed'
          ? 'подтверждена'
          : 'ожидает подтверждения',
  }));

  const inTrip = trips.find((trip) => trip.status === 'in_trip');

  if (!inTrip) {
    return { text: messageMyTrips(lines) };
  }

  // Из этого же сообщения водитель начинает возврат: отдельную команду искать
  // не нужно.
  return {
    text: messageMyTrips(lines),
    buttons: [{ text: `Оформить возврат #${inTrip.id}`, data: 'return:start' }],
  };
}
