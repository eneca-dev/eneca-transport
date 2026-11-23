import 'server-only';

import { cardK3, cardK4 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { listEmployeesByRole } from '@/modules/employees/queries';
import { DOCUMENT_AFFECTING, describeChange } from '@/modules/trips/changeLog';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';

/**
 * Уведомления вокруг документов: К3 финотделу и К4 автору.
 *
 * Пока роль «финотдел» никому не выдана, К3 отправлять некому. Это не ошибка:
 * запись в журнале отправок с причиной остаётся, и как только роль появится,
 * новые заявки начнут доходить. Старые при этом не догонят — они видны в Э5.
 */

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

interface ParticipantRow {
  employees: { display_name: string } | null;
}

const TRIP_SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, docs_ready_at, ' +
  'docs_recheck_required, ' +
  'cars(plate, model), drivers(full_name), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

async function loadTrip(tripId: number): Promise<{ trip: TripRow; data: TripCardData } | null> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    console.error(`Поездка #${tripId}: не удалось собрать данные для К3/К4`, error);
    return null;
  }

  const { data: participants } = await db
    .from('trip_participants')
    .select('employees(display_name)')
    .eq('trip_id', tripId)
    .returns<ParticipantRow[]>();

  return {
    trip,
    data: {
      id: trip.id,
      startsAt: trip.starts_at,
      endsAt: trip.ends_at,
      route: trip.route,
      contract: trip.contract,
      purpose: trip.purpose,
      carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
      driverLabel: trip.drivers?.full_name ?? null,
      authorName: trip.employees?.display_name ?? '—',
      participantNames: (participants ?? []).map((row) => row.employees?.display_name ?? '—'),
    },
  };
}

/**
 * К3: сообщить финотделу о заявке.
 *
 * `attempt` отличает повторные проверки: при изменении заявки карточка должна
 * уйти снова, а ключ защиты от повтора уникален, поэтому в него входит повод.
 */
export async function notifyFinanceNewRequest(tripId: number, attempt = 'new'): Promise<void> {
  const loaded = await loadTrip(tripId);

  if (!loaded) {
    return;
  }

  const recipients = await listEmployeesByRole('finance');
  const changes = loaded.trip.docs_recheck_required ? await loadChanges(tripId) : [];
  const card = cardK3(loaded.data, loaded.trip.docs_recheck_required, changes);

  if (recipients.length === 0) {
    await skipDelivery(
      {
        template: 'K3',
        channel: 'teams',
        tripId,
        // Получателя нет, но запись нужна: иначе непонятно, почему финотдел
        // ничего не получил. Пишем на автора — он точно существует.
        recipient: { employeeId: loaded.trip.author_id },
        dedupeKey: `K3:trip:${tripId}:${attempt}:no-recipient`,
      },
      'Роль «финотдел» никому не выдана — отправлять некому',
    );
    return;
  }

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K3',
          channel: 'teams',
          tripId,
          recipient: { employeeId: person.id },
          dedupeKey: `K3:trip:${tripId}:${attempt}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, card),
      ),
    ),
  );
}

interface EventRow {
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Что изменилось после последней отметки «Документы готовы».
 *
 * Тот же перечень, что в Э5, и собирается он тем же описателем: иначе карточка
 * и экран рассказывали бы об одном событии по-разному.
 */
async function loadChanges(tripId: number): Promise<string[]> {
  const db = getDb();

  const { data: trip } = await db
    .from('trips')
    .select('docs_ready_at')
    .eq('id', tripId)
    .maybeSingle<{ docs_ready_at: string | null }>();

  const { data, error } = await db
    .from('trip_events')
    .select('kind, payload, created_at')
    .eq('trip_id', tripId)
    .order('created_at')
    .returns<EventRow[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать изменения`, error);
    return [];
  }

  const since = trip?.docs_ready_at ?? null;

  return (data ?? [])
    .filter((event) => since === null || event.created_at > since)
    .filter((event) =>
      DOCUMENT_AFFECTING.includes(event.kind as (typeof DOCUMENT_AFFECTING)[number]),
    )
    .map((event) => describeChange(event))
    .filter((line): line is string => line !== null);
}

/** К4: сообщить автору, что документы готовы. */
export async function notifyDocsReady(tripId: number): Promise<void> {
  const loaded = await loadTrip(tripId);

  if (!loaded?.trip.employees) {
    return;
  }

  const author = loaded.trip.employees;

  await deliverOnce(
    {
      template: 'K4',
      channel: 'teams',
      tripId,
      recipient: { employeeId: loaded.trip.author_id },
      // В ключ входит момент готовности: повторная подготовка после изменения
      // заявки сообщит снова, а двойное нажатие на ту же кнопку — нет.
      dedupeKey: `K4:trip:${tripId}:${loaded.trip.docs_ready_at ?? 'unknown'}`,
    },
    () => sendCard(loaded.trip.author_id, author.entra_oid, cardK4(loaded.data)),
  );
}
