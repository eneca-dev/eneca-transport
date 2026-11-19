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

import { minskDayBounds, minskHour, toMinskDate } from './booking';

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
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string; telegram_chat_id: number | null } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, driver_id, ' +
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
        () => sendCard(trip.author_id, author.entra_oid, cardK5(toCardData(trip), departure)),
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
            messageT3(trip.id, trip.route, departure, carLabel),
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
    .select('id, ends_at')
    .eq('status', 'in_trip')
    .returns<{ id: number; ends_at: string }[]>();

  if (issues.error || inTrip.error) {
    throw new Error(
      `Не удалось собрать сводку рецепции: ${(issues.error ?? inTrip.error)!.message}`,
    );
  }

  const counts = {
    issues: (issues.data ?? []).length,
    returns: (inTrip.data ?? []).filter(
      (row) => row.ends_at >= nowIso && row.ends_at < to.toISOString(),
    ).length,
    overdue: (inTrip.data ?? []).filter((row) => row.ends_at < nowIso).length,
  };

  if (counts.issues + counts.returns + counts.overdue === 0) {
    return 0;
  }

  const day = toMinskDate(now);
  const recipients = await listEmployeesByRole('reception');
  const card = cardK6(counts);

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
 * К15 автору и АХО — ключи не сданы.
 *
 * Берутся поездки, у которых плановый возврат был раньше начала сегодняшних
 * минских суток: «не сданы до утра» из требований. Напоминаем раз в день,
 * поэтому в ключе дата.
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

  const trips = data ?? [];
  const day = toMinskDate(now);
  const aho = await listEmployeesByRole('aho');

  for (const trip of trips) {
    const card = cardK15(toCardData(trip), formatMoment(new Date(trip.ends_at)));

    const recipients = [
      ...(trip.employees
        ? [{ id: trip.author_id, entraOid: trip.employees.entra_oid }]
        : []),
      ...aho
        .filter((person) => person.id !== trip.author_id)
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
