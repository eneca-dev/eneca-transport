import 'server-only';

import { cardK12, cardK13 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { sendTelegramMessage } from '@/lib/bots/telegram';
import { messageT4 } from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { listEmployeesByRole } from '@/modules/employees/queries';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import type { TripCardData, TripChange } from '@/lib/bots/cards';

/**
 * Уведомления об изменении заявки: К12 всем причастным, Т4 водителю, К13 когда
 * бронь затронута ремонтом или недоступностью.
 *
 * Список получателей К12 задан требованиями: автор, участники, водитель
 * (ему — Т4), рецепция и финотдел. Рецепции и финотделу это нужно, потому что
 * у них на экранах висят выдачи и документы по прежним данным.
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
  docs_recheck_required: boolean;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string; telegram_chat_id: number | null } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

interface ParticipantRow {
  employee_id: string;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, driver_id, ' +
  'docs_recheck_required, cars(plate, model), drivers(full_name, telegram_chat_id), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

async function loadTrip(tripId: number): Promise<TripRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать для уведомлений`, error);
    return null;
  }
  return data;
}

function toCardData(trip: TripRow, participantNames: string[]): TripCardData {
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
    participantNames,
  };
}

interface Recipient {
  id: string;
  entraOid: string;
}

/**
 * Кому уходит К12. Повторы убираются по идентификатору: автор может быть и
 * в АХО, и в финотделе одновременно.
 */
async function changeRecipients(trip: TripRow): Promise<{
  recipients: Recipient[];
  participantNames: string[];
}> {
  const db = getDb();

  const { data: participants, error } = await db
    .from('trip_participants')
    .select('employee_id, employees(entra_oid, display_name)')
    .eq('trip_id', trip.id)
    .returns<ParticipantRow[]>();

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось прочитать участников`, error);
  }

  const people = (participants ?? []).filter((row) => row.employees !== null);

  const [reception, finance] = await Promise.all([
    listEmployeesByRole('reception'),
    listEmployeesByRole('finance'),
  ]);

  const all: Recipient[] = [
    ...(trip.employees ? [{ id: trip.author_id, entraOid: trip.employees.entra_oid }] : []),
    ...people.map((row) => ({ id: row.employee_id, entraOid: row.employees!.entra_oid })),
    ...reception.map((person) => ({ id: person.id, entraOid: person.entraOid })),
    ...finance.map((person) => ({ id: person.id, entraOid: person.entraOid })),
  ];

  const unique = new Map(all.map((person) => [person.id, person]));

  return {
    recipients: [...unique.values()],
    participantNames: people.map((row) => row.employees!.display_name),
  };
}

/**
 * К12 всем причастным и Т4 водителю.
 *
 * `reason` входит в ключ защиты от повтора: перенос и отмена одной поездки —
 * разные события, а два переноса подряд должны дать два сообщения.
 */
export async function notifyTripChanged(
  tripId: number,
  change: TripChange,
  details: string,
  reason: string,
  needsNewConfirmation = false,
): Promise<void> {
  const trip = await loadTrip(tripId);

  if (!trip) {
    return;
  }

  const { recipients, participantNames } = await changeRecipients(trip);
  const card = cardK12(
    toCardData(trip, participantNames),
    change,
    details,
    trip.docs_recheck_required,
  );

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K12',
          channel: 'teams',
          tripId,
          recipient: { employeeId: person.id },
          dedupeKey: `K12:trip:${tripId}:${reason}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, card),
      ),
    ),
  );

  if (!trip.driver_id) {
    return;
  }

  const entry = {
    template: 'T4',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId: trip.driver_id },
    dedupeKey: `T4:trip:${tripId}:${reason}`,
  };
  const chatId = trip.drivers?.telegram_chat_id ?? null;

  if (chatId === null) {
    await skipDelivery(entry, 'У водителя не подключён Telegram');
    return;
  }

  await deliverOnce(entry, () =>
    sendTelegramMessage(
      chatId,
      messageT4(tripId, trip.route, details, needsNewConfirmation),
      { withKeyboard: true },
    ),
  );
}

/**
 * К13: бронь затронута ремонтом машины или недоступностью водителя.
 *
 * Уходит автору и АХО. Бронь не трогаем: по требованиям она сохраняется, и
 * решение принимает человек.
 */
export async function notifyBookingAffected(
  tripId: number,
  reasonText: string,
  reasonKey: string,
): Promise<void> {
  const trip = await loadTrip(tripId);

  if (!trip) {
    return;
  }

  const data = toCardData(trip, []);
  const aho = await listEmployeesByRole('aho');

  const targets: { person: Recipient; forAho: boolean }[] = [
    ...(trip.employees
      ? [
          {
            person: { id: trip.author_id, entraOid: trip.employees.entra_oid },
            forAho: false,
          },
        ]
      : []),
    ...aho
      .filter((person) => person.id !== trip.author_id)
      .map((person) => ({
        person: { id: person.id, entraOid: person.entraOid },
        forAho: true,
      })),
  ];

  await Promise.all(
    targets.map(({ person, forAho }) =>
      deliverOnce(
        {
          template: 'K13',
          channel: 'teams',
          tripId,
          recipient: { employeeId: person.id },
          dedupeKey: `K13:trip:${tripId}:${reasonKey}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, cardK13(data, reasonText, forAho)),
      ),
    ),
  );
}
