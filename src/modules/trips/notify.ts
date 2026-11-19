import 'server-only';

import { cardK1, cardK2 } from '@/lib/bots/cards';
import { NotInstalledError, sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { deliverOnce } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';

/**
 * Уведомления о созданной брони: К1 автору, К2 участникам.
 *
 * Отправка идёт сразу, а не через планировщик: событие уже произошло, ждать
 * нечего. Журнал отправок и защиту от повтора держит `outbox`.
 *
 * Ни одна ошибка отправки не роняет создание поездки: бронь уже в базе, и
 * отменять её из-за недоставленного сообщения неправильно.
 */

interface Recipient {
  employeeId: string;
  entraOid: string;
  displayName: string;
}

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

interface ParticipantRow {
  employee_id: string;
  employees: { entra_oid: string; display_name: string } | null;
}

/** Человеческая причина, по которой карточка не дошла. */
export function sendFailureReason(error: unknown): string {
  if (error instanceof NotInstalledError) {
    return 'Приложение Teams не установлено у получателя';
  }
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}

/**
 * К1 автору и К2 участникам.
 *
 * Участник, у которого приложение не установлено, К2 не получит: Teams не даёт
 * боту написать первым. Это ограничение Teams, а не нашего кода, и снимется
 * публикацией приложения в каталоге организации.
 */
export async function notifyTripBooked(tripId: number): Promise<void> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(
      'id, starts_at, ends_at, route, contract, purpose, author_id, ' +
        'cars(plate, model), drivers(full_name), ' +
        'employees!trips_author_id_fkey(entra_oid, display_name)',
    )
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    console.error(`Поездка #${tripId}: не удалось собрать данные для уведомлений`, error);
    return;
  }

  const { data: participants, error: participantsError } = await db
    .from('trip_participants')
    .select('employee_id, employees(entra_oid, display_name)')
    .eq('trip_id', tripId)
    .returns<ParticipantRow[]>();

  if (participantsError) {
    console.error(`Поездка #${tripId}: не удалось прочитать участников`, participantsError);
  }

  const people: Recipient[] = (participants ?? [])
    .filter((row) => row.employees !== null)
    .map((row) => ({
      employeeId: row.employee_id,
      entraOid: row.employees!.entra_oid,
      displayName: row.employees!.display_name,
    }));

  const data: TripCardData = {
    id: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    contract: trip.contract,
    purpose: trip.purpose,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    driverLabel: trip.drivers?.full_name ?? null,
    authorName: trip.employees?.display_name ?? '—',
    participantNames: people.map((person) => person.displayName),
  };

  const tasks: Promise<void>[] = [];

  if (trip.employees) {
    const author = trip.employees;
    tasks.push(
      deliverOnce(
        {
          template: 'K1',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: trip.author_id },
          dedupeKey: `K1:trip:${trip.id}`,
        },
        () => sendCard(trip.author_id, author.entra_oid, cardK1(data)),
      ),
    );
  }

  const card = cardK2(data);

  for (const person of people) {
    tasks.push(
      deliverOnce(
        {
          template: 'K2',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.employeeId },
          dedupeKey: `K2:trip:${trip.id}:employee:${person.employeeId}`,
        },
        () => sendCard(person.employeeId, person.entraOid, card),
      ),
    );
  }

  // Получатели независимы: один недоставленный не задерживает остальных.
  await Promise.all(tasks);
}
