import 'server-only';

import {
  DRIVER_CONFIRMATION_MINUTES,
  NO_DRIVER_ASK_HOURS,
  RETURN_REPEAT_HOURS,
} from '@/config/app';
import { getDb } from '@/config/supabase';

import { isMinskWorkingTime } from './booking';
import { notifyAuthorNoDriver, notifyDriverTimeout } from './notifyDriver';
import { notifyDriverReturnDue } from './notifyDriverReturn';
import { notifyReturnDue } from './notifyReturnDue';
import { runReminders } from './reminders';

import type { RemindersResult } from './reminders';

/**
 * Сроки, за которыми следит планировщик.
 *
 * Здесь только то, где события нет, а наступает срок: водитель молчит 15 минут,
 * подошло время выезда без подтверждённого водителя, просрочен возврат. Всё,
 * что вызвано действием человека, отправляется сразу в Server Action и сюда не
 * попадает.
 *
 * Каждая проверка идемпотентна: она сначала меняет состояние, а потом
 * отправляет. Повторный запуск не найдёт ту же поездку, а если найдёт —
 * `dedupe_key` в `notifications` не даст отправить второй раз. Поэтому
 * пропущенный или сдвоенный запуск безвреден.
 */

export interface TickResult {
  /** Назначений, у которых вышли 15 минут. */
  driverTimeouts: number;
  /**
   * Поездок, у которых наступил выезд без подтверждённого водителя. Это
   * найденные поездки, а не отправленные карточки: повторную отправку
   * отсекает занятый ключ, а поездка остаётся в этом состоянии до решения
   * автора и попадает в счётчик каждый проход.
   */
  tripsWithoutDriver: number;
  /** Поездок без водителя, которым пора оформить возврат. */
  returnsDue: number;
  /** Поездок с водителем, которым пора оформить возврат. */
  driverReturnsDue: number;
  /** Напоминания: накануне выезда, сводка рецепции, несданные ключи. */
  reminders: RemindersResult;
}

interface TripIdRow {
  id: number;
}

interface DueTripRow {
  id: number;
  ends_at: string;
}

/** Пора ли повторить просьбу о возврате: прошло два часа после планового. */
function isRepeatDue(endsAt: string, now: number): boolean {
  return now - new Date(endsAt).getTime() >= RETURN_REPEAT_HOURS * 3_600_000;
}

/**
 * Водитель не ответил за отведённое время.
 *
 * Отсчёт идёт от `driver_assigned_at` — момента отправки Т1, как в требованиях,
 * а не от создания заявки: при замене водителя отсчёт начинается заново.
 *
 * Вне рабочего времени молчание не объявляется вовсе. Иначе заявка,
 * заведённая в пятницу в 22:00, в 22:15 даёт АХО К14 «водитель не
 * подтвердил», и вся ветка замены срабатывает на ровном месте: водитель
 * просто спал. Срок не отменяется, он лишь не истекает, пока никто не
 * работает, — и в понедельник в девять утра истечёт.
 *
 * Исключений нет, в том числе для близкого выезда. Ночью замену всё равно
 * никто не назначит, а разбудить ради этого троих — худшее из двух.
 *
 * Переводится именно состояние, а не только отправка сообщений: пока стоит
 * `pending`, водитель может нажать «Подтверждаю» и ночью, и это сработает.
 */
async function expireDriverConfirmations(): Promise<number> {
  const now = new Date();

  if (!isMinskWorkingTime(now)) {
    return 0;
  }

  const db = getDb();
  const deadline = new Date(now.getTime() - DRIVER_CONFIRMATION_MINUTES * 60_000).toISOString();

  // Статус меняется тем же запросом, которым ищется: между выборкой и
  // обновлением водитель мог успеть нажать «Подтверждаю», и перезаписывать его
  // ответ нельзя.
  const { data, error } = await db
    .from('trips')
    .update({ driver_confirmation: 'timeout', updated_at: now.toISOString() })
    .eq('driver_confirmation', 'pending')
    .lte('driver_assigned_at', deadline)
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .select('id')
    .returns<TripIdRow[]>();

  if (error) {
    throw new Error(`Не удалось отметить неподтверждённые назначения: ${error.message}`);
  }

  const expired = data ?? [];

  for (const trip of expired) {
    const { error: eventError } = await db.from('trip_events').insert({
      trip_id: trip.id,
      kind: 'driver_timeout',
      payload: { minutes: DRIVER_CONFIRMATION_MINUTES },
    });

    if (eventError) {
      console.error(`Поездка #${trip.id}: событие о таймауте не записано`, eventError);
    }

    try {
      await notifyDriverTimeout(trip.id);
    } catch (notifyError) {
      // Статус уже переведён, и это главное: АХО увидит его в карточке даже
      // без сообщения. Повторять отправку будет нечем до И6, поэтому пишем
      // в журнал сервера.
      console.error(`Поездка #${trip.id}: уведомления о таймауте не ушли`, notifyError);
    }
  }

  return expired.length;
}

/**
 * Выезд близко, а подтверждённого водителя нет.
 *
 * Спрашиваем за `NO_DRIVER_ASK_HOURS` до выезда, а не в момент выезда, как
 * было: выбор «поеду сам или отменить» в 07:00 на поездку в 07:00 — это не
 * выбор. Карточка по-прежнему одна: ключ защиты от повтора тот же.
 *
 * Статус поездки не меняется: по требованиям бронь сохраняется, пока автор не
 * выберет — ехать самому или отменить. Значит повторный проход найдёт ту же
 * поездку, и от повторной отправки защищает только занятый ключ `K16:trip:N`.
 * Поэтому ключ занимается до отправки, а не после.
 *
 * Вне рабочего времени вопрос не задаётся: он о том же, о чём молчание
 * водителя. Если два часа до выезда пришлись на ночь, карточка уйдёт в девять
 * утра — выбор «поеду сам или отменить» остаётся настоящим и тогда.
 */
async function askAuthorsWithoutDriver(): Promise<number> {
  if (!isMinskWorkingTime(new Date())) {
    return 0;
  }

  const db = getDb();
  const askFrom = new Date(Date.now() + NO_DRIVER_ASK_HOURS * 3_600_000).toISOString();

  const { data, error } = await db
    .from('trips')
    .select('id')
    .eq('needs_driver', true)
    .neq('driver_confirmation', 'confirmed')
    .lte('starts_at', askFrom)
    .in('status', ['booked', 'docs_ready'])
    .returns<TripIdRow[]>();

  if (error) {
    throw new Error(`Не удалось найти поездки без водителя: ${error.message}`);
  }

  const trips = data ?? [];

  for (const trip of trips) {
    try {
      await notifyAuthorNoDriver(trip.id);
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: К16 не ушла`, notifyError);
    }
  }

  return trips.length;
}

/**
 * Плановое время возврата наступило, а показания одометра нет.
 *
 * Только для поездок без водителя: с водителем возврат начинает он сам из
 * Telegram, и вторая точка ввода одометра создала бы расхождение.
 *
 * Состояние поездки не меняется, поэтому каждый проход найдёт её снова —
 * от повторной отправки защищает занятый ключ `K8:trip:N`.
 *
 * Через `RETURN_REPEAT_HOURS` после планового возврата уходит повтор с другим
 * ключом — один раз. Так в требованиях: «ключи не сданы — через 2 часа
 * повтор», а утром К15 уже и автору, и АХО.
 */
async function askAuthorsToReturn(): Promise<number> {
  const db = getDb();
  const now = Date.now();

  const { data, error } = await db
    .from('trips')
    .select('id, ends_at')
    .eq('status', 'in_trip')
    .eq('needs_driver', false)
    .is('odometer_end_km', null)
    .lte('ends_at', new Date(now).toISOString())
    .returns<DueTripRow[]>();

  if (error) {
    throw new Error(`Не удалось найти поездки к возврату: ${error.message}`);
  }

  const trips = data ?? [];

  for (const trip of trips) {
    try {
      await notifyReturnDue(trip.id);

      if (isRepeatDue(trip.ends_at, now)) {
        await notifyReturnDue(trip.id, true);
      }
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: К8 не ушла`, notifyError);
    }
  }

  return trips.length;
}

/**
 * Плановое время возврата у поездки С водителем: начинаем разговор в Telegram.
 *
 * Отдельно от поездок без водителя, потому что получатель другой и канал
 * другой. Условие одно: показания одометра ещё нет.
 */
async function askDriversToReturn(): Promise<number> {
  const db = getDb();
  const now = Date.now();

  const { data, error } = await db
    .from('trips')
    .select('id, ends_at')
    .eq('status', 'in_trip')
    .eq('needs_driver', true)
    .not('driver_id', 'is', null)
    .is('odometer_end_km', null)
    .lte('ends_at', new Date(now).toISOString())
    .returns<DueTripRow[]>();

  if (error) {
    throw new Error(`Не удалось найти поездки водителей к возврату: ${error.message}`);
  }

  const trips = data ?? [];

  for (const trip of trips) {
    try {
      await notifyDriverReturnDue(trip.id);

      if (isRepeatDue(trip.ends_at, now)) {
        await notifyDriverReturnDue(trip.id, true);
      }
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: Т5 не ушла`, notifyError);
    }
  }

  return trips.length;
}

/** Один проход планировщика. */
export async function runDeadlines(): Promise<TickResult> {
  // Сначала сроки подтверждения: поездка, у которой только что вышли 15 минут,
  // должна успеть получить статус до проверки «нет подтверждённого водителя».
  const driverTimeouts = await expireDriverConfirmations();
  const tripsWithoutDriver = await askAuthorsWithoutDriver();
  const returnsDue = await askAuthorsToReturn();
  const driverReturnsDue = await askDriversToReturn();
  const reminders = await runReminders();

  return { driverTimeouts, tripsWithoutDriver, returnsDue, driverReturnsDue, reminders };
}
