import 'server-only';

import { cardK14, cardK16 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { answerCallback, closeTelegramButtons, sendTelegramMessage } from '@/lib/bots/telegram';
import { messageT1, messageT1Answered, messageT2 } from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import { sendFailureReason } from './notify';

import type { TripCardData } from '@/lib/bots/cards';
import type { AssignmentMessage } from '@/lib/bots/telegramMessages';

/**
 * Назначение водителя: Т1 с кнопками, ответ водителя, и что делать, когда
 * водителя нет.
 *
 * Т1 уходит сразу при создании брони — событие есть, ждать нечего. На часах
 * висит только молчание: 15 минут без ответа дают Т2 и К14, а наступившее
 * время выезда без подтверждённого водителя — К16 автору. Это делает
 * планировщик (`deadlines.ts`).
 */

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  driver_id: string | null;
  driver_confirmation: string;
  cars: { plate: string; model: string } | null;
  drivers: { id: string; full_name: string; telegram_chat_id: number | null } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const TRIP_SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, driver_id, ' +
  'driver_confirmation, cars(plate, model), drivers(id, full_name, telegram_chat_id), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

async function loadTrip(tripId: number): Promise<TripRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error) {
    throw new Error(`Не удалось прочитать поездку #${tripId}: ${error.message}`);
  }
  return data;
}

async function loadPassengers(tripId: number, authorName: string): Promise<string[]> {
  const { data, error } = await getDb()
    .from('trip_participants')
    .select('employees(display_name)')
    .eq('trip_id', tripId)
    .returns<{ employees: { display_name: string } | null }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать пассажиров`, error);
    return [authorName];
  }

  return [authorName, ...(data ?? []).map((row) => row.employees?.display_name ?? '—')];
}

function toAssignment(trip: TripRow, passengers: string[]): AssignmentMessage {
  return {
    tripId: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    passengers,
  };
}

function toCardData(trip: TripRow, driverLabel: string | null): TripCardData {
  return {
    id: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    contract: trip.contract,
    purpose: trip.purpose,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    driverLabel,
    authorName: trip.employees?.display_name ?? '—',
    participantNames: [],
  };
}

/**
 * Т1: сообщить водителю о назначении.
 *
 * Ошибки не выбрасываются: бронь уже создана, и отменять её из-за того, что
 * водитель не подключил Telegram, нельзя. Причина остаётся в журнале отправок,
 * а в Э3 — статус «ожидается подтверждение».
 */
export async function notifyDriverAssigned(tripId: number): Promise<void> {
  try {
    const trip = await loadTrip(tripId);

    if (!trip?.drivers || !trip.driver_id) {
      return;
    }

    const driver = trip.drivers;
    const entry = {
      template: 'T1',
      channel: 'telegram' as const,
      tripId,
      recipient: { driverId: driver.id },
      dedupeKey: `T1:trip:${tripId}:driver:${driver.id}`,
    };

    if (driver.telegram_chat_id === null) {
      await skipDelivery(entry, 'У водителя не подключён Telegram');
      return;
    }

    const chatId = driver.telegram_chat_id;
    const passengers = await loadPassengers(tripId, trip.employees?.display_name ?? '—');
    const assignment = toAssignment(trip, passengers);

    await deliverOnce(entry, () =>
      sendTelegramMessage(chatId, messageT1(assignment), [
        { text: 'Подтверждаю', data: `confirm:${tripId}` },
        { text: 'Не могу', data: `decline:${tripId}` },
      ]),
    );
  } catch (error) {
    console.error(`Поездка #${tripId}: Т1 не отправлена: ${sendFailureReason(error)}`);
  }
}

/**
 * Т2 водителю и К14 в АХО, когда 15 минут вышли без ответа.
 *
 * Статус к этому моменту уже переведён в `timeout` планировщиком — здесь только
 * сообщения.
 */
export async function notifyDriverTimeout(tripId: number): Promise<void> {
  const trip = await loadTrip(tripId);

  if (!trip?.drivers || !trip.driver_id) {
    return;
  }

  const driver = trip.drivers;
  const entry = {
    template: 'T2',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId: driver.id },
    dedupeKey: `T2:trip:${tripId}:driver:${driver.id}`,
  };

  if (driver.telegram_chat_id === null) {
    await skipDelivery(entry, 'У водителя не подключён Telegram');
  } else {
    const chatId = driver.telegram_chat_id;
    await deliverOnce(entry, () => sendTelegramMessage(chatId, messageT2(tripId)));
  }

  await notifyAhoDriverMissing(trip, driver.full_name, 'timeout');
}

/** К14: сообщить АХО, что водителя нет. */
async function notifyAhoDriverMissing(
  trip: TripRow,
  driverName: string,
  reason: 'declined' | 'timeout',
): Promise<void> {
  const { data: aho, error } = await getDb()
    .from('employee_roles')
    .select('employees!employee_roles_employee_id_fkey(id, entra_oid, display_name, is_active)')
    .eq('role', 'aho')
    .returns<
      {
        employees: { id: string; entra_oid: string; display_name: string; is_active: boolean } | null;
      }[]
    >();

  if (error) {
    console.error('Не удалось найти сотрудников АХО для К14', error);
    return;
  }

  const card = cardK14(toCardData(trip, driverName), driverName, reason);

  // Роль, а не конкретный человек: в требованиях К14 адресована Дарье, но
  // сотрудников АХО может быть несколько, и назначать замену может любой.
  const recipients = (aho ?? [])
    .map((row) => row.employees)
    .filter((person): person is NonNullable<typeof person> => person !== null && person.is_active);

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K14',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.id },
          dedupeKey: `K14:trip:${trip.id}:${reason}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entra_oid, card),
      ),
    ),
  );
}

/**
 * К16: автору, к плановому времени выезда нет подтверждённого водителя.
 *
 * Бронь при этом не трогаем: по требованиям она сохраняется, пока автор не
 * выбрал — ехать самому или отменить.
 */
export async function notifyAuthorNoDriver(tripId: number): Promise<void> {
  const trip = await loadTrip(tripId);

  if (!trip?.employees) {
    return;
  }

  const author = trip.employees;
  const state =
    trip.driver_confirmation === 'declined'
      ? 'отказался'
      : trip.driver_confirmation === 'timeout'
        ? 'не подтвердил'
        : 'не ответил';

  const card = cardK16(toCardData(trip, trip.drivers?.full_name ?? null), state);

  await deliverOnce(
    {
      template: 'K16',
      channel: 'teams',
      tripId,
      recipient: { employeeId: trip.author_id },
      dedupeKey: `K16:trip:${tripId}`,
    },
    () => sendCard(trip.author_id, author.entra_oid, card),
  );
}

export interface DriverCallback {
  callbackId: string;
  chatId: number;
  messageId: number;
  /** «confirm:24» или «decline:24». */
  data: string;
}

/**
 * Ответ водителя на Т1.
 *
 * Поездка проверяется по chat_id того, кто нажал: кнопку можно переслать, но
 * ответить за другого водителя нельзя.
 */
export async function handleDriverCallback(callback: DriverCallback): Promise<void> {
  const match = /^(confirm|decline):(\d+)$/.exec(callback.data);

  if (!match) {
    await answerCallback(callback.callbackId, 'Эта кнопка больше не действует.');
    return;
  }

  const confirmed = match[1] === 'confirm';
  const tripId = Number(match[2]);
  const db = getDb();

  const { data: driver, error: driverError } = await db
    .from('drivers')
    .select('id, full_name')
    .eq('telegram_chat_id', callback.chatId)
    .maybeSingle<{ id: string; full_name: string }>();

  if (driverError || !driver) {
    await answerCallback(callback.callbackId, 'Вы не подключены как водитель.');
    return;
  }

  const trip = await loadTrip(tripId);

  if (!trip || trip.driver_id !== driver.id) {
    await answerCallback(callback.callbackId, 'Это назначение уже не ваше.');
    return;
  }

  // Ответ принимается только пока ждут ответа: после замены водителя или
  // решения автора по К16 кнопки прежнего назначения не работают.
  if (trip.driver_confirmation !== 'pending') {
    await answerCallback(callback.callbackId, 'На это назначение вы уже ответили.');
    return;
  }

  const { error: updateError } = await db
    .from('trips')
    .update({
      driver_confirmation: confirmed ? 'confirmed' : 'declined',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId);

  if (updateError) {
    console.error(`Поездка #${tripId}: не удалось записать ответ водителя`, updateError);
    await answerCallback(callback.callbackId, 'Не получилось сохранить ответ. Попробуйте ещё раз.');
    return;
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: confirmed ? 'driver_confirmed' : 'driver_declined',
    payload: {},
    actor_driver: driver.id,
  });

  // По требованиям К14 уходит Дарье сразу после «Не могу». Поэтому она
  // отправляется до работы с самим сообщением в Telegram: правка кнопок —
  // косметика, и её отказ не должен оставить АХО без уведомления.
  if (!confirmed) {
    await notifyAhoDriverMissing(trip, driver.full_name, 'declined');
  }

  const passengers = await loadPassengers(tripId, trip.employees?.display_name ?? '—');
  const assignment = toAssignment(trip, passengers);

  try {
    await answerCallback(callback.callbackId, confirmed ? 'Подтверждено' : 'Передал в АХО');
    await closeTelegramButtons(
      callback.chatId,
      callback.messageId,
      messageT1Answered(assignment, confirmed),
    );
  } catch (error) {
    // Ответ уже записан и АХО уведомлено. Непогашенные кнопки — неприятно, но
    // повторное нажатие отсекается проверкой статуса выше.
    console.error(`Поездка #${tripId}: не удалось обновить сообщение водителя`, error);
  }
}
