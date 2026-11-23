import 'server-only';

import { answerCallback, editTelegramMessage } from '@/lib/bots/telegram';
import {
  messageDriverDay,
  messageDriverFreeDay,
  messageDriverMonth,
} from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { formatDateLabel, formatMonthLabel } from '@/lib/datetime';

import {
  busyDays,
  currentMinskMonth,
  DAY_PATTERN,
  minskDay,
  minskMonth,
  monthGrid,
  MONTH_PATTERN,
} from './calendarGrid';
import { driverByChat } from './queries';

import type { DriverDayTrip } from '@/lib/bots/telegramMessages';
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
  if (trip.driver_confirmation === 'timeout') {
    return 'подтверждение просрочено';
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
 */
async function tripsInRange(driverId: string, from: Date, to: Date): Promise<CalendarTripRow[]> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('driver_id', driverId)
    .neq('status', 'cancelled')
    .lt('starts_at', to.toISOString())
    .gte('ends_at', from.toISOString())
    .order('starts_at')
    .returns<CalendarTripRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать график водителя: ${error.message}`);
  }

  return data ?? [];
}

/** Календарь месяца: подпись и сетка. */
export async function driverMonthReply(driverId: string, month: string): Promise<BotReply> {
  const { from, to } = minskMonth(month);
  const trips = await tripsInRange(driverId, from, to);

  const busy = busyDays(
    month,
    trips.map((trip) => ({ startsAt: trip.starts_at, endsAt: trip.ends_at })),
  );

  return {
    text: messageDriverMonth(formatMonthLabel(month), trips.length),
    rows: monthGrid(month, busy, currentMinskMonth()),
  };
}

/** Один день: поездки этого дня и кнопка назад в месяц. */
async function driverDayReply(driverId: string, date: string): Promise<BotReply> {
  const { from, to } = minskDay(date);
  const trips = await tripsInRange(driverId, from, to);

  return {
    text: messageDriverDay(formatDateLabel(date), trips.map(toDayTrip)),
    rows: [[{ text: '‹ Календарь', data: `cal:m:${date.slice(0, 7)}` }]],
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
