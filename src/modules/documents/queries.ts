import 'server-only';

import { getDb } from '@/config/supabase';

/**
 * Очередь документов (Э5) — то, что ждёт финотдела.
 *
 * В очередь попадает заявка, по которой документы ещё не готовы, и заявка,
 * которую изменили после подготовки: прежний комплект стал неактуален, и
 * финотдел проверяет заново.
 */

export interface DocumentQueueItem {
  id: number;
  startsAt: string;
  endsAt: string;
  route: string;
  contract: string;
  purpose: string;
  authorName: string;
  participantNames: string[];
  carLabel: string | null;
  driverName: string | null;
  /** Заявка уже была готова и изменилась — повторная проверка. */
  recheck: boolean;
  docsReadyAt: string | null;
}

interface QueueRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { display_name: string } | null;
}

interface ParticipantRow {
  trip_id: number;
  employees: { display_name: string } | null;
}

const QUEUE_SELECT =
  'id, starts_at, ends_at, route, contract, purpose, docs_ready_at, docs_recheck_required, ' +
  'cars(plate, model), drivers(full_name), employees!trips_author_id_fkey(display_name)';

export async function listDocumentQueue(): Promise<DocumentQueueItem[]> {
  const db = getDb();

  // Отменённые и закрытые в очереди не нужны: по отменённой подготовка
  // прекращается, по закрытой документы уже не понадобятся.
  const { data: trips, error } = await db
    .from('trips')
    .select(QUEUE_SELECT)
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .or('docs_ready_at.is.null,docs_recheck_required.is.true')
    .order('starts_at')
    .returns<QueueRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать очередь документов: ${error.message}`);
  }

  const rows = trips ?? [];

  if (rows.length === 0) {
    return [];
  }

  const { data: participants, error: participantsError } = await db
    .from('trip_participants')
    .select('trip_id, employees(display_name)')
    .in(
      'trip_id',
      rows.map((row) => row.id),
    )
    .returns<ParticipantRow[]>();

  if (participantsError) {
    throw new Error(`Не удалось прочитать участников: ${participantsError.message}`);
  }

  const byTrip = new Map<number, string[]>();
  for (const row of participants ?? []) {
    const names = byTrip.get(row.trip_id) ?? [];
    names.push(row.employees?.display_name ?? '—');
    byTrip.set(row.trip_id, names);
  }

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    route: row.route,
    contract: row.contract,
    purpose: row.purpose,
    authorName: row.employees?.display_name ?? '—',
    participantNames: byTrip.get(row.id) ?? [],
    carLabel: row.cars ? `${row.cars.model} ${row.cars.plate}` : null,
    driverName: row.drivers?.full_name ?? null,
    recheck: row.docs_recheck_required,
    docsReadyAt: row.docs_ready_at,
  }));
}
