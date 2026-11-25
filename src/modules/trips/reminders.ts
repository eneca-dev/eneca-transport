import 'server-only';

import { cardK15, cardK5, cardK6 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { sendTelegramMessage } from '@/lib/bots/telegram';
import { messageT3 } from '@/lib/bots/telegramMessages';
import {
  OVERDUE_REMINDER_HOUR,
  RECEPTION_MORNING_HOUR,
  REMINDER_EVE_HOUR,
} from '@/config/app';
import { getDb } from '@/config/supabase';
import { formatMoment } from '@/lib/datetime';
import { listEmployeesByRole } from '@/modules/employees/queries';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import { isMinskWeekend, minskDayBounds, minskHour, toMinskDate } from './booking';
import { tripLabelFrom, tripRef } from './tripLabel';

import type { TripCardData } from '@/lib/bots/cards';

/**
 * Напоминания по расписанию: К5 и Т3 накануне выезда, К6 рецепции утром,
 * К15 о несданных ключах.
 *
 * Все три привязаны к часу по минскому времени. Планировщик ходит раз в минуту,
 * поэтому условие «уже наступил такой-то час» выполняется весь остаток дня — от
 * повторной отправки защищает ключ с датой в нём.
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
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  odometer_end_km: number | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string; telegram_chat_id: number | null } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, driver_id, ' +
  'docs_ready_at, docs_recheck_required, odometer_end_km, ' +
  'cars(plate, model), drivers(full_name, telegram_chat_id), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

function toCardData(trip: TripRow): TripCardData {
  return {
    id: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    contract: trip.contract,
    purpose: trip.purpose,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    driverLabel: trip.drivers?.full_name ?? null,
    authorName: trip.employees?.display_name ?? '—',
    participantNames: [],
  };
}

/**
 * К5 автору и Т3 водителю — накануне выезда после 17:00.
 *
 * Выезды ищем на завтрашние минские сутки. Поездка, созданная позже 17:00 на
 * завтра, тоже получит напоминание — следующим же проходом планировщика.
 */
async function remindDayBefore(now: Date): Promise<number> {
  if (minskHour(now) < REMINDER_EVE_HOUR) {
    return 0;
  }

  const db = getDb();
  const tomorrow = minskDayBounds(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const { data, error } = await db
    .from('trips')
    .select(SELECT)
    .in('status', ['booked', 'docs_ready'])
    .gte('starts_at', tomorrow.from.toISOString())
    .lt('starts_at', tomorrow.to.toISOString())
    .returns<TripRow[]>();

  if (error) {
    throw new Error(`Не удалось найти выезды на завтра: ${error.message}`);
  }

  const trips = data ?? [];

  for (const trip of trips) {
    const departure = formatMoment(new Date(trip.starts_at));

    if (trip.employees) {
      const author = trip.employees;
      await deliverOnce(
        {
          template: 'K5',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: trip.author_id },
          dedupeKey: `K5:trip:${trip.id}`,
        },
        () =>
          sendCard(
            trip.author_id,
            author.entra_oid,
            cardK5(
              toCardData(trip),
              departure,
              trip.docs_ready_at !== null && !trip.docs_recheck_required,
            ),
          ),
      );
    }

    if (trip.driver_id) {
      const entry = {
        template: 'T3',
        channel: 'telegram' as const,
        tripId: trip.id,
        recipient: { driverId: trip.driver_id },
        dedupeKey: `T3:trip:${trip.id}`,
      };
      const chatId = trip.drivers?.telegram_chat_id ?? null;

      if (chatId === null) {
        await skipDelivery(entry, 'У водителя не подключён Telegram');
      } else {
        const carLabel = trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null;
        await deliverOnce(entry, () =>
          sendTelegramMessage(
            chatId,
            messageT3(
              tripRef(trip),
              departure,
              carLabel,
              trip.employees?.display_name ?? null,
            ),
            { withKeyboard: true },
          ),
        );
      }
    }
  }

  return trips.length;
}

/**
 * К6 рецепции — утренняя сводка. Одна карточка на день, а не на каждую выдачу.
 *
 * Если на день ничего нет и просрочек тоже нет, карточка не отправляется:
 * пустая сводка каждое утро быстро перестаёт читаться.
 */
async function remindReception(now: Date): Promise<number> {
  if (minskHour(now) < RECEPTION_MORNING_HOUR) {
    return 0;
  }

  const db = getDb();
  const { to } = minskDayBounds(now);
  const nowIso = now.toISOString();

  const issues = await db
    .from('trips')
    .select('id')
    .in('status', ['booked', 'docs_ready'])
    .lt('starts_at', to.toISOString())
    .returns<{ id: number }[]>();

  const inTrip = await db
    .from('trips')
    .select('id, starts_at, ends_at, route')
    .eq('status', 'in_trip')
    .returns<{ id: number; starts_at: string; ends_at: string; route: string }[]>();

  if (issues.error || inTrip.error) {
    throw new Error(
      `Не удалось собрать сводку рецепции: ${(issues.error ?? inTrip.error)!.message}`,
    );
  }

  const overdue = (inTrip.data ?? []).filter((row) => row.ends_at < nowIso);

  const counts = {
    issues: (issues.data ?? []).length,
    returns: (inTrip.data ?? []).filter(
      (row) => row.ends_at >= nowIso && row.ends_at < to.toISOString(),
    ).length,
    overdue: overdue.length,
  };

  if (counts.issues + counts.returns + counts.overdue === 0) {
    return 0;
  }

  const day = toMinskDate(now);
  const recipients = await listEmployeesByRole('reception');
  const card = cardK6(
    counts,
    overdue.map((row) => tripLabelFrom(row.route, row.starts_at, row.ends_at)),
  );

  for (const person of recipients) {
    await deliverOnce(
      {
        template: 'K6',
        channel: 'teams',
        // Сводка не про одну поездку: в журнале отправок она стоит сама по
        // себе, иначе ссылка на поездку была бы ложью.
        tripId: null,
        recipient: { employeeId: person.id },
        dedupeKey: `K6:${day}:employee:${person.id}`,
        payload: counts,
      },
      () => sendCard(person.id, person.entraOid, card),
    );
  }

  return recipients.length;
}

/**
 * Оставить только те поездки, по которым К15 ещё ни разу не уходила.
 *
 * Ключ защиты от повтора занимается до отправки, поэтому строка в
 * `notifications` есть у каждой попытки — именно это и нужно: «напоминали
 * хоть раз».
 */
async function neverRemindedYet(trips: TripRow[]): Promise<TripRow[]> {
  const { data, error } = await getDb()
    .from('notifications')
    .select('trip_id')
    .eq('template', 'K15')
    .in(
      'trip_id',
      trips.map((trip) => trip.id),
    )
    .returns<{ trip_id: number }[]>();

  if (error) {
    // Проверить не удалось — лучше напомнить лишний раз, чем промолчать о
    // машине, которая не вернулась.
    console.error('Не удалось проверить прежние К15', error);
    return trips;
  }

  const reminded = new Set((data ?? []).map((row) => row.trip_id));
  return trips.filter((trip) => !reminded.has(trip.id));
}

/**
 * К15 автору и АХО — ключи не сданы.
 *
 * Берутся поездки, у которых плановый возврат был раньше начала сегодняшних
 * минских суток: «не сданы до утра» из требований. Напоминаем раз в день,
 * поэтому в ключе дата.
 *
 * В выходной напоминаем только в первый раз. Ключи принимает рецепция, в
 * субботу она закрыта, и повтор просит сделать невозможное — после двух таких
 * К15 перестают читать вообще. Первое напоминание уходит в любой день: «машина
 * не вернулась» — это новость, а не повтор.
 */
async function remindOverdue(now: Date): Promise<number> {
  if (minskHour(now) < OVERDUE_REMINDER_HOUR) {
    return 0;
  }

  const db = getDb();
  const { from } = minskDayBounds(now);

  const { data, error } = await db
    .from('trips')
    .select(SELECT)
    .eq('status', 'in_trip')
    .lt('ends_at', from.toISOString())
    .returns<TripRow[]>();

  if (error) {
    throw new Error(`Не удалось найти несданные ключи: ${error.message}`);
  }

  const found = data ?? [];
  const trips = found.length > 0 && isMinskWeekend(now) ? await neverRemindedYet(found) : found;

  if (trips.length === 0) {
    return 0;
  }

  const day = toMinskDate(now);
  const aho = await listEmployeesByRole('aho');

  for (const trip of trips) {
    /**
     * Показание передано — автор сделал всё, что мог.
     *
     * Прежде К15 уходила ему каждое утро с текстом «ключи не сданы», хотя
     * сдать их он уже не может: ключи принимает рецепция. Упрекать человека за
     * чужую работу нельзя, поэтому в этом случае напоминание остаётся АХО —
     * она за этим и следит.
     */
    const odometerIn = trip.odometer_end_km !== null;
    const withAuthor = trip.employees !== null && !odometerIn;

    const card = cardK15(toCardData(trip), formatMoment(new Date(trip.ends_at)), odometerIn);

    const recipients = [
      ...(withAuthor && trip.employees
        ? [{ id: trip.author_id, entraOid: trip.employees.entra_oid }]
        : []),
      ...aho
        .filter((person) => !withAuthor || person.id !== trip.author_id)
        .map((person) => ({ id: person.id, entraOid: person.entraOid })),
    ];

    for (const person of recipients) {
      await deliverOnce(
        {
          template: 'K15',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.id },
          dedupeKey: `K15:trip:${trip.id}:${day}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, card),
      );
    }
  }

  return trips.length;
}

export interface RemindersResult {
  /** Выездов на завтра, по которым напомнили. */
  dayBefore: number;
  /** Сотрудников рецепции, получивших сводку. */
  reception: number;
  /** Поездок с несданными ключами. */
  overdue: number;
}

export async function runReminders(now = new Date()): Promise<RemindersResult> {
  return {
    dayBefore: await remindDayBefore(now),
    reception: await remindReception(now),
    overdue: await remindOverdue(now),
  };
}
