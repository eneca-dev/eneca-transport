import 'server-only';

import { cardDriverLateConfirm, cardK14, cardK16 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import {
  answerCallback,
  closeTelegramButtons,
  editTelegramMessage,
  sendTelegramMessage,
} from '@/lib/bots/telegram';
import { acceptCondition, acceptNote, askReturnStep } from './driverReturn';
import {
  messageDriverConfirmedByAho,
  messageT1,
  messageT1Answered,
} from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { ANSWER_PATTERN } from '@/modules/drivers/calendarGrid';
import {
  driverDayReply,
  handleCalendarCallback,
  isCalendarCallback,
} from '@/modules/drivers/calendar';
import { deliverOnce } from '@/modules/notifications/outbox';

import { sendFailureReason } from './notify';
import { tripLabelFrom } from './tripLabel';
import { ahoRecipients, skipDriverDelivery } from './undelivered';

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
      await skipDriverDelivery(entry, {
        tripId,
        driverId: driver.id,
        driverName: driver.full_name,
        what: 'запрос подтверждения поездки',
      });
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
      await skipDriverDelivery(entry, {
        tripId,
        driverId: driver.id,
        driverName: driver.full_name,
        what: 'сообщение о том, что поездка закреплена за ним',
      });
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

type AnswerOutcome =
  | { ok: true; driverId: string; trip: TripRow; toast: string }
  | { ok: false; toast: string };

/**
 * Записать ответ водителя на назначение.
 *
 * Общая часть для двух кнопок: в самом сообщении с назначением и в календаре.
 * Разойдутся — и подтверждение из календаря перестанет уведомлять АХО.
 *
 * Поездка проверяется по chat_id того, кто нажал: кнопку можно переслать, но
 * ответить за другого водителя нельзя.
 */
async function recordDriverAnswer(
  chatId: number,
  tripId: number,
  confirmed: boolean,
): Promise<AnswerOutcome> {
  const db = getDb();

  const { data: driver, error: driverError } = await db
    .from('drivers')
    .select('id, full_name')
    .eq('telegram_chat_id', chatId)
    .maybeSingle<{ id: string; full_name: string }>();

  if (driverError || !driver) {
    return { ok: false, toast: 'Вы не подключены как водитель.' };
  }

  const trip = await loadTrip(tripId);

  if (!trip || trip.driver_id !== driver.id) {
    return { ok: false, toast: 'Это назначение уже не ваше.' };
  }

  // Ключи выданы — спорить не о чем: машина либо в пути, либо поездка закрыта.
  if (trip.keys_issued_at !== null || !['booked', 'docs_ready'].includes(trip.status)) {
    return { ok: false, toast: 'По этой поездке решения уже приняты.' };
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
    return {
      ok: false,
      toast: confirmed ? 'Эта поездка уже подтверждена.' : 'Вы уже отказались, АХО знает.',
    };
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
    return { ok: false, toast: 'Не получилось сохранить ответ. Попробуйте ещё раз.' };
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

  return {
    ok: true,
    driverId: driver.id,
    trip,
    toast: confirmed ? 'Подтверждено' : 'Передал в АХО',
  };
}

/** Ответили кнопкой в сообщении с назначением: кнопки Т1 гасим. */
async function answerFromAssignment(
  callback: DriverCallback,
  tripId: number,
  confirmed: boolean,
): Promise<void> {
  const outcome = await recordDriverAnswer(callback.chatId, tripId, confirmed);

  if (!outcome.ok) {
    await answerCallback(callback.callbackId, outcome.toast);
    return;
  }

  const passengers = await loadPassengers(tripId);
  const assignment = toAssignment(outcome.trip, passengers);

  try {
    await answerCallback(callback.callbackId, outcome.toast);
    await closeTelegramButtons(
      callback.chatId,
      callback.messageId,
      messageT1Answered(assignment, confirmed),
    );
  } catch (error) {
    // Ответ уже записан и АХО уведомлено. Непогашенные кнопки — неприятно, но
    // повторное нажатие отсекается проверкой состояния выше.
    console.error(`Поездка #${tripId}: не удалось обновить сообщение водителя`, error);
  }
}

/**
 * Ответили кнопкой в календаре: перерисовываем тот же день.
 *
 * Сообщение с календарём остаётся календарём — водитель видит в нём новое
 * состояние поездки и может листать дальше. Заменить его на текст назначения
 * значило бы закрыть календарь за одно нажатие.
 */
async function answerFromCalendar(
  callback: DriverCallback,
  tripId: number,
  date: string,
  confirmed: boolean,
): Promise<void> {
  const outcome = await recordDriverAnswer(callback.chatId, tripId, confirmed);

  if (!outcome.ok) {
    await answerCallback(callback.callbackId, outcome.toast);
    return;
  }

  await answerCallback(callback.callbackId, outcome.toast);

  try {
    const reply = await driverDayReply(outcome.driverId, date);
    await editTelegramMessage(callback.chatId, callback.messageId, reply.text, reply.rows ?? []);
  } catch (error) {
    console.error(`Поездка #${tripId}: не удалось перерисовать день календаря`, error);
  }
}

/**
 * Нажатия кнопок водителя в Telegram.
 *
 * Разбор по видам кнопок: календарь, диалог возврата, ответ на назначение.
 * Ответ на назначение приходит из двух мест — из самого сообщения с
 * назначением и из календаря, — и дальше они расходятся только тем, что
 * показать после ответа.
 */
export async function handleDriverCallback(callback: DriverCallback): Promise<void> {
  // Ответ на назначение из календаря. Проверяется раньше остальных кнопок
  // календаря: они начинаются с того же «cal:», но в базе ничего не меняют.
  const fromCalendar = ANSWER_PATTERN.exec(callback.data);

  if (fromCalendar) {
    await answerFromCalendar(
      callback,
      Number(fromCalendar[2]),
      fromCalendar[3],
      fromCalendar[1] === 'c',
    );
    return;
  }

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

  await answerFromAssignment(callback, Number(match[2]), match[1] === 'confirm');
}

/**
 * Т4 снятому водителю: на поездку назначили другого.
 *
 * Отдельно от К12, потому что водителю нужно не «что изменилось в заявке», а
 * одно: ехать больше не надо.
 *
 * Имя сменщика не называется: водителю оно ни к чему, а расстановку людей
 * ведёт АХО и объясняет её сама, если надо.
 */
export async function notifyDriverUnassigned(tripId: number, driverId: string): Promise<void> {
  const trip = await loadTrip(tripId);

  const { data: driver, error } = await getDb()
    .from('drivers')
    .select('full_name, telegram_chat_id')
    .eq('id', driverId)
    .maybeSingle<{ full_name: string; telegram_chat_id: number | null }>();

  const entry = {
    template: 'T4',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId },
    dedupeKey: `T4:trip:${tripId}:unassigned:${Date.now()}`,
  };

  if (error || driver === null || driver.telegram_chat_id === null) {
    await skipDriverDelivery(entry, {
      tripId,
      driverId,
      driverName: driver?.full_name ?? 'водитель',
      what: 'сообщение о снятии с поездки',
    });
    return;
  }

  const chatId = driver.telegram_chat_id;

  await deliverOnce(entry, () =>
    sendTelegramMessage(
      chatId,
      [
        `${trip ? tripLabelFrom(trip.id, trip.starts_at, trip.ends_at) : `Поездка ${tripId}`}: вас сняли с поездки.`,
        '',
        'Ничего делать не нужно.',
      ].join('\n'),
      { withKeyboard: true },
    ),
  );
}
