import 'server-only';

import { answerCallback, editTelegramMessage } from '@/lib/bots/telegram';
import {
  messageDriverDay,
  messageDriverFreeDay,
  messageDriverMonth,
} from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { formatDateLabel, formatMonthLabel } from '@/lib/datetime';
import { toMinskDate } from '@/modules/trips/booking';

import {
  currentMinskMonth,
  DAY_MARK,
  DAY_MARK_LABEL,
  DAY_PATTERN,
  dayMarks,
  dayRows,
  minskDay,
  minskMonth,
  monthGrid,
  MONTH_PATTERN,
  usedMarks,
} from './calendarGrid';
import { driverByChat, driverUnavailability, REASON_LABEL } from './queries';

import type { DayMark, MarkedSpan } from './calendarGrid';
import type { DriverDayTrip } from '@/lib/bots/telegramMessages';
import type { DriverUnavailability } from './queries';
import type { BotReply } from '@/modules/trips/driverReturn';

/**
 * Календарь водителя в Telegram.
 *
 * Список «Мои поездки» отвечает на вопрос «что у меня сейчас». Календарь
 * отвечает на другой: «что у меня вообще» — когда водитель планирует свои дни
 * и хочет видеть месяц целиком.
 *
 * Сетка — обычная inline-клавиатура по семь кнопок в ряд: в Telegram это
 * единственный способ нарисовать календарь. Листание правит то же сообщение,
 * а не присылает новое, иначе переписка зарастает календарями.
 *
 * Арифметика месяцев — в `calendarGrid`, здесь только база и отправка.
 */

export { currentMinskMonth } from './calendarGrid';

const SELECT =
  'id, status, starts_at, ends_at, route, driver_confirmation, ' +
  'cars(model, plate), employees!trips_author_id_fkey(display_name)';

interface CalendarTripRow {
  id: number;
  status: string;
  starts_at: string;
  ends_at: string;
  route: string;
  driver_confirmation: string | null;
  cars: { model: string; plate: string } | null;
  employees: { display_name: string } | null;
}

function statusOf(trip: CalendarTripRow): DriverDayTrip['status'] {
  if (trip.status === 'closed') {
    return 'закрыта';
  }
  if (trip.status === 'in_trip') {
    return 'в пути';
  }
  if (trip.driver_confirmation === 'declined') {
    return 'вы отказались';
  }
  if (trip.driver_confirmation === 'confirmed') {
    return 'подтверждена';
  }
  return 'ожидает подтверждения';
}

function toDayTrip(trip: CalendarTripRow): DriverDayTrip {
  return {
    tripId: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    status: statusOf(trip),
    responsible: trip.employees?.display_name ?? null,
  };
}

/**
 * Поездки водителя, которые задевают заданный отрезок.
 *
 * Отменённые не берутся: бронь освобождена, и в графике водителя их нет.
 * Закрытые берутся — водитель спрашивает и про прошлый месяц тоже.
 *
 * Поездки, от которых водитель отказался, тоже не берутся. Формально он с них
 * ещё не снят — снимет АХО, — но для него они уже чужие, и зелёный кружок в
 * его календаре означал бы, что ехать всё-таки ему.
 */
async function tripsInRange(driverId: string, from: Date, to: Date): Promise<CalendarTripRow[]> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('driver_id', driverId)
    .neq('status', 'cancelled')
    .neq('driver_confirmation', 'declined')
    .lt('starts_at', to.toISOString())
    .gte('ends_at', from.toISOString())
    .order('starts_at')
    .returns<CalendarTripRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать график водителя: ${error.message}`);
  }

  return data ?? [];
}

/** Каким кружком помечается день с этой поездкой. */
function markOf(trip: CalendarTripRow): DayMark {
  if (trip.status === 'closed') {
    return 'closed';
  }
  if (trip.driver_confirmation === 'pending' || trip.driver_confirmation === 'timeout') {
    return 'pending';
  }
  return 'active';
}

/** «Отпуск с 2 декабря по 9 декабря» — строка для дня. */
function awayLine(period: DriverUnavailability): string {
  const reason = REASON_LABEL[period.reason];
  const head = `${reason[0].toUpperCase()}${reason.slice(1)}`;

  const when =
    period.since === period.until
      ? head
      : `${head} с ${formatDateLabel(period.since)} по ${formatDateLabel(period.until)}`;

  return period.note ? `${when}. ${period.note}` : `${when}.`;
}

/** Календарь месяца: подпись и сетка. */
export async function driverMonthReply(driverId: string, month: string): Promise<BotReply> {
  const { from, to } = minskMonth(month);
  const monthStart = `${month}-01`;
  const monthEnd = toMinskDate(new Date(to.getTime() - 1));

  const [trips, away] = await Promise.all([
    tripsInRange(driverId, from, to),
    driverUnavailability(driverId, monthStart, monthEnd),
  ]);

  const spans: MarkedSpan[] = [
    ...trips.map((trip) => ({
      startsAt: trip.starts_at,
      endsAt: trip.ends_at,
      mark: markOf(trip),
    })),
    // У периода отсутствия только даты, без времени: берём минские сутки
    // целиком, иначе последний день выпал бы из пометок.
    ...away.map((period) => ({
      startsAt: minskDay(period.since).from.toISOString(),
      endsAt: new Date(minskDay(period.until).to.getTime() - 1).toISOString(),
      mark: 'away' as const,
    })),
  ];

  const marks = dayMarks(month, spans);
  const legend = usedMarks(marks).map((mark) => `${DAY_MARK[mark]} ${DAY_MARK_LABEL[mark]}`);

  return {
    text: messageDriverMonth(formatMonthLabel(month), trips.length, legend),
    rows: monthGrid(month, marks, currentMinskMonth()),
  };
}

/**
 * Ждут ли от водителя ответа по этой поездке.
 *
 * Молчание дольше 15 минут ответа не отменяет: подтвердить можно, пока
 * рецепция не выдала ключи.
 */
function awaitsAnswer(trip: CalendarTripRow): boolean {
  return (
    ['booked', 'docs_ready'].includes(trip.status) &&
    (trip.driver_confirmation === 'pending' || trip.driver_confirmation === 'timeout')
  );
}

/** Один день: поездки этого дня, отметка об отсутствии и кнопки. */
export async function driverDayReply(driverId: string, date: string): Promise<BotReply> {
  const { from, to } = minskDay(date);

  const [trips, away] = await Promise.all([
    tripsInRange(driverId, from, to),
    driverUnavailability(driverId, date, date),
  ]);

  const rows = dayRows(
    date,
    trips.map((trip) => ({ tripId: trip.id, awaitsAnswer: awaitsAnswer(trip) })),
  );

  return {
    text: messageDriverDay(
      formatDateLabel(date),
      trips.map(toDayTrip),
      away.length > 0 ? away.map(awayLine).join('\n') : null,
    ),
    rows,
  };
}

export interface CalendarCallback {
  callbackId: string;
  chatId: number;
  messageId: number;
  data: string;
}

/** Нажатия в календаре начинаются с `cal:`. */
export function isCalendarCallback(data: string): boolean {
  return data.startsWith('cal:');
}

/**
 * Нажали кнопку в календаре.
 *
 * Водитель определяется по чату, а не по данным кнопки: пересланное сообщение
 * не должно показывать чужой график.
 */
export async function handleCalendarCallback(callback: CalendarCallback): Promise<void> {
  // Заголовок месяца, названия дней недели и пустые клетки: нажатие гасим
  // молча, иначе у водителя крутится индикатор на кнопке до таймаута.
  if (callback.data === 'cal:x') {
    await answerCallback(callback.callbackId);
    return;
  }

  const driver = await driverByChat(callback.chatId);

  if (!driver) {
    await answerCallback(callback.callbackId, 'Вы не подключены как водитель.');
    return;
  }

  const free = /^cal:f:(.+)$/.exec(callback.data);

  // День без поездок: показываем подсказку и не трогаем сетку. Перерисовывать
  // её ради «поездок нет» значит мигать календарём на каждое нажатие.
  if (free && DAY_PATTERN.test(free[1])) {
    await answerCallback(callback.callbackId, messageDriverFreeDay(formatDateLabel(free[1])));
    return;
  }

  const day = /^cal:d:(.+)$/.exec(callback.data);
  const month = /^cal:m:(.+)$/.exec(callback.data);

  const reply =
    day && DAY_PATTERN.test(day[1])
      ? await driverDayReply(driver.id, day[1])
      : month && MONTH_PATTERN.test(month[1])
        ? await driverMonthReply(driver.id, month[1])
        : null;

  if (!reply) {
    await answerCallback(callback.callbackId, 'Эта кнопка больше не действует.');
    return;
  }

  await answerCallback(callback.callbackId);
  await editTelegramMessage(callback.chatId, callback.messageId, reply.text, reply.rows ?? []);
}
