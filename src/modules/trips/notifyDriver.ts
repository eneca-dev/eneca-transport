import 'server-only';

import { cardDriverLateConfirm, cardK14, cardK16 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { answerCallback, closeTelegramButtons, sendTelegramMessage } from '@/lib/bots/telegram';
import { acceptCondition, acceptNote, askReturnStep } from './driverReturn';
import {
  messageDriverConfirmedByAho,
  messageT1,
  messageT1Answered,
} from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { handleCalendarCallback, isCalendarCallback } from '@/modules/drivers/calendar';
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
  status: string;
  keys_issued_at: string | null;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  driver_id: string | null;
  driver_confirmation: string;
  driver_assigned_at: string | null;
  cars: { plate: string; model: string } | null;
  drivers: { id: string; full_name: string; telegram_chat_id: number | null } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const TRIP_SELECT =
  'id, status, keys_issued_at, starts_at, ends_at, route, contract, purpose, ' +
  'author_id, driver_id, driver_confirmation, driver_assigned_at, ' +
  'cars(plate, model), drivers(id, full_name, telegram_chat_id), ' +
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

/**
 * Участники без автора.
 *
 * Автор идёт отдельной строкой «Ответственный»: водителю важно знать не просто
 * список фамилий, а к кому обращаться, если на месте что-то не так.
 */
async function loadPassengers(tripId: number): Promise<string[]> {
  const { data, error } = await getDb()
    .from('trip_participants')
    .select('employees(display_name)')
    .eq('trip_id', tripId)
    .returns<{ employees: { display_name: string } | null }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать пассажиров`, error);
    return [];
  }

  return (data ?? []).map((row) => row.employees?.display_name ?? '—');
}

function toAssignment(trip: TripRow, passengers: string[]): AssignmentMessage {
  return {
    tripId: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    responsible: trip.employees?.display_name ?? '—',
    passengers,
    contract: trip.contract,
    purpose: trip.purpose,
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
      // В ключ входит момент назначения: после переноса или замены водителя
      // должен уйти новый запрос, а не наткнуться на старый ключ.
      dedupeKey: `T1:trip:${tripId}:driver:${driver.id}:${trip.driver_assigned_at ?? 'first'}`,
    };

    if (driver.telegram_chat_id === null) {
      await skipDelivery(entry, 'У водителя не подключён Telegram');
      return;
    }

    const chatId = driver.telegram_chat_id;
    const passengers = await loadPassengers(tripId);
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
 * К14 в АХО, когда 15 минут вышли без ответа.
 *
 * Водителю не отправляется ничего. Требования предусматривают здесь Т2
 * «подтверждение не получено», но 15 минут — просьба, а не обязанность: чаще
 * всего водитель в этот момент за рулём. Сообщение о том, что его молчание
 * передали в АХО, торопит и выглядит упрёком, а решает вопрос всё равно
 * звонок. Кнопки Т1 у водителя при этом остаются рабочими, и подтвердить он
 * может позже.
 *
 * Статус к этому моменту уже переведён в `timeout` планировщиком — здесь только
 * сообщения.
 */
export async function notifyDriverTimeout(tripId: number): Promise<void> {
  const trip = await loadTrip(tripId);

  if (!trip?.drivers || !trip.driver_id) {
    return;
  }

  await notifyAhoDriverMissing(trip, trip.drivers.full_name, 'timeout');
}

interface AhoPerson {
  id: string;
  entra_oid: string;
  display_name: string;
  is_active: boolean;
}

/**
 * Кому из АХО уходят карточки о водителях.
 *
 * Роль, а не конкретный человек: в требованиях К14 адресована Дарье, но
 * сотрудников АХО может быть несколько, и назначать замену может любой.
 */
async function ahoRecipients(purpose: string): Promise<AhoPerson[]> {
  const { data, error } = await getDb()
    .from('employee_roles')
    .select('employees!employee_roles_employee_id_fkey(id, entra_oid, display_name, is_active)')
    .eq('role', 'aho')
    .returns<{ employees: AhoPerson | null }[]>();

  if (error) {
    console.error(`Не удалось найти сотрудников АХО для ${purpose}`, error);
    return [];
  }

  return (data ?? [])
    .map((row) => row.employees)
    .filter((person): person is AhoPerson => person !== null && person.is_active);
}

/** К14: сообщить АХО, что водителя нет. */
async function notifyAhoDriverMissing(
  trip: TripRow,
  driverName: string,
  reason: 'declined' | 'timeout',
): Promise<void> {
  const card = cardK14(toCardData(trip, driverName), driverName, reason);
  const recipients = await ahoRecipients('К14');

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K14',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.id },
          dedupeKey:
            `K14:trip:${trip.id}:${reason}:${trip.driver_assigned_at ?? 'first'}` +
            `:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entra_oid, card),
      ),
    ),
  );
}

/**
 * АХО: водитель ответил позже 15 минут и подтвердил сам.
 *
 * Без этого К14 остаётся последним, что знает АХО, и она ищет замену человеку,
 * который тем временем согласился ехать.
 *
 * В ключ входит момент назначения, а не время ответа: на одно назначение такая
 * карточка нужна один раз, сколько бы раз водитель ни передумал.
 */
async function notifyAhoDriverLateConfirm(trip: TripRow, driverName: string): Promise<void> {
  const card = cardDriverLateConfirm(toCardData(trip, driverName), driverName);
  const recipients = await ahoRecipients('подтверждения водителя');

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K14_LATE',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.id },
          dedupeKey:
            `K14_LATE:trip:${trip.id}:${trip.driver_assigned_at ?? 'first'}` +
            `:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entra_oid, card),
      ),
    ),
  );
}

/**
 * Водителю: АХО подтвердила поездку за него.
 *
 * Водитель нередко соглашается голосом по телефону, а в бот не заходит. Он
 * должен знать, что поездка за ним закреплена — иначе он ждёт, что назначат
 * кого-то другого, и к выезду не готовится.
 */
export async function notifyDriverConfirmedByAho(tripId: number): Promise<void> {
  try {
    const trip = await loadTrip(tripId);

    if (!trip?.drivers || !trip.driver_id) {
      return;
    }

    const driver = trip.drivers;
    const entry = {
      template: 'T1_AHO',
      channel: 'telegram' as const,
      tripId,
      recipient: { driverId: driver.id },
      dedupeKey: `T1_AHO:trip:${tripId}:driver:${driver.id}:${trip.driver_assigned_at ?? 'first'}`,
    };

    if (driver.telegram_chat_id === null) {
      await skipDelivery(entry, 'У водителя не подключён Telegram');
      return;
    }

    const chatId = driver.telegram_chat_id;
    const passengers = await loadPassengers(tripId);
    const assignment = toAssignment(trip, passengers);

    await deliverOnce(entry, () =>
      sendTelegramMessage(chatId, messageDriverConfirmedByAho(assignment), {
        withKeyboard: true,
      }),
    );
  } catch (error) {
    // Подтверждение уже записано, и это главное: в Э3 оно видно, а АХО с
    // водителем только что говорила по телефону.
    console.error(`Поездка #${tripId}: сообщение о подтверждении не ушло: ${sendFailureReason(error)}`);
  }
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

/**
 * Кнопки диалога возврата.
 *
 * Номер поездки в них не нужен: у водителя в пути одна поездка, и шаг
 * выводится из неё. Поэтому кнопка не может относиться к чужой или прошлой
 * поездке — проверять нечего.
 */
async function handleReturnCallback(callback: DriverCallback): Promise<void> {
  const { data: driver, error } = await getDb()
    .from('drivers')
    .select('id')
    .eq('telegram_chat_id', callback.chatId)
    .maybeSingle<{ id: string }>();

  if (error || !driver) {
    await answerCallback(callback.callbackId, 'Вы не подключены как водитель.');
    return;
  }

  const reply =
    callback.data === 'cond:ok'
      ? await acceptCondition(driver.id, true)
      : callback.data === 'cond:remark'
        ? await acceptCondition(driver.id, false)
        : callback.data === 'note:skip'
          ? await acceptNote(driver.id, '')
          : await askReturnStep(driver.id);

  if (!reply) {
    await answerCallback(callback.callbackId, 'Этот шаг уже пройден.');
    return;
  }

  await answerCallback(callback.callbackId);

  try {
    // Кнопки прежнего шага гасим: нажать «Да» второй раз уже нечего.
    await closeTelegramButtons(callback.chatId, callback.messageId, 'Записал.');
  } catch (closeError) {
    console.error('Не удалось погасить кнопки шага возврата', closeError);
  }

  await sendTelegramMessage(callback.chatId, reply.text, {
    buttons: reply.buttons,
    withKeyboard: reply.buttons === undefined,
  });
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
  // Календарь: листание месяцев и просмотр дня. Отдельной веткой, потому что
  // он не про одну поездку и ничего в базе не меняет.
  if (isCalendarCallback(callback.data)) {
    await handleCalendarCallback(callback);
    return;
  }

  // Кнопки диалога возврата: состояние машины, пропуск примечания, начало.
  if (['cond:ok', 'cond:remark', 'note:skip', 'return:start'].includes(callback.data)) {
    await handleReturnCallback(callback);
    return;
  }

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

  // Ключи выданы — спорить не о чем: машина либо в пути, либо поездка закрыта.
  if (trip.keys_issued_at !== null || !['booked', 'docs_ready'].includes(trip.status)) {
    await answerCallback(callback.callbackId, 'По этой поездке решения уже приняты.');
    return;
  }

  /**
   * Ответ принимается, пока ключи не выданы, — в том числе после 15 минут.
   *
   * 15 минут — просьба, а не срок, после которого водителя перестают слушать:
   * он мог быть за рулём. Отсечь нужно только повтор того же самого ответа,
   * иначе нажатие второй раз молча перезаписывает запись в журнале.
   */
  const previous = trip.driver_confirmation;

  if (previous === (confirmed ? 'confirmed' : 'declined')) {
    await answerCallback(
      callback.callbackId,
      confirmed ? 'Эта поездка уже подтверждена.' : 'Вы уже отказались, АХО знает.',
    );
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
  } else if (previous !== 'pending') {
    // Молчание или отказ АХО уже видела в К14. Теперь водитель едет сам, и об
    // этом она должна узнать, пока не нашла замену.
    await notifyAhoDriverLateConfirm(trip, driver.full_name);
  }

  const passengers = await loadPassengers(tripId);
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

/**
 * Т4 снятому водителю: на поездку назначили другого.
 *
 * Отдельно от К12, потому что водителю нужно не «что изменилось в заявке», а
 * одно: ехать больше не надо.
 */
export async function notifyDriverUnassigned(
  tripId: number,
  driverId: string,
  replacedBy: string,
): Promise<void> {
  const { data: driver, error } = await getDb()
    .from('drivers')
    .select('telegram_chat_id')
    .eq('id', driverId)
    .maybeSingle<{ telegram_chat_id: number | null }>();

  const entry = {
    template: 'T4',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId },
    dedupeKey: `T4:trip:${tripId}:unassigned:${Date.now()}`,
  };

  if (error || driver?.telegram_chat_id === null || driver === null) {
    await skipDelivery(entry, 'У водителя не подключён Telegram');
    return;
  }

  const chatId = driver.telegram_chat_id;

  await deliverOnce(entry, () =>
    sendTelegramMessage(
      chatId,
      [
        `Поездка #${tripId}: вас сняли с поездки.`,
        '',
        `Поедет ${replacedBy}. Ничего делать не нужно.`,
      ].join('\n'),
      { withKeyboard: true },
    ),
  );
}
