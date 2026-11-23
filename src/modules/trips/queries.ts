import 'server-only';

import { getDb } from '@/config/supabase';

export type TripStatus = 'draft' | 'booked' | 'docs_ready' | 'in_trip' | 'closed' | 'cancelled';

export type DriverConfirmation =
  | 'not_required'
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'timeout';

export interface TripParticipant {
  employeeId: string;
  displayName: string;
}

/** Строка списка «Мои поездки» (Э1). */
export interface TripListItem {
  id: number;
  status: TripStatus;
  startsAt: string;
  endsAt: string;
  route: string;
  needsDriver: boolean;
  carPlate: string | null;
  carModel: string | null;
  driverName: string | null;
  driverConfirmation: DriverConfirmation;
  distanceKm: number | null;
  docsReadyAt: string | null;
  docsRecheckRequired: boolean;
  keysIssuedAt: string | null;
  /** Нужен состоянию поездки: показание передано, но ключи не приняты. */
  odometerEndKm: number | null;
  /** Человек в этой поездке автор или только участник. */
  isAuthor: boolean;
  authorName: string;
}

/** Полная карточка поездки (Э3). */
export interface TripCard extends TripListItem {
  contract: string;
  purpose: string;
  participants: TripParticipant[];
  keysReturnedAt: string | null;
  odometerStartKm: number | null;
  conditionOk: boolean | null;
  returnNote: string | null;
  cancelledAt: string | null;
  events: TripEvent[];
}

export interface TripEvent {
  id: number;
  kind: string;
  createdAt: string;
  actorName: string | null;
  payload: Record<string, unknown>;
}

interface NamedRow {
  display_name: string;
}

interface TripRow {
  id: number;
  status: TripStatus;
  author_id: string;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  needs_driver: boolean;
  driver_confirmation: DriverConfirmation;
  distance_km: number | null;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  keys_issued_at: string | null;
  keys_returned_at: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  condition_ok: boolean | null;
  return_note: string | null;
  cancelled_at: string | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: NamedRow | null;
}

// Связь с автором указывается по имени внешнего ключа: из trips есть ссылки и на
// автора, и на тех, кто выдал ключи, принял их и отменил поездку.
const TRIP_SELECT =
  'id, status, author_id, starts_at, ends_at, route, contract, purpose, needs_driver, ' +
  'driver_confirmation, distance_km, docs_ready_at, docs_recheck_required, ' +
  'keys_issued_at, keys_returned_at, odometer_start_km, odometer_end_km, ' +
  'condition_ok, return_note, cancelled_at, ' +
  'cars(plate, model), drivers(full_name), employees!trips_author_id_fkey(display_name)';

function toListItem(row: TripRow, viewerId: string): TripListItem {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    route: row.route,
    needsDriver: row.needs_driver,
    carPlate: row.cars?.plate ?? null,
    carModel: row.cars?.model ?? null,
    driverName: row.drivers?.full_name ?? null,
    driverConfirmation: row.driver_confirmation,
    distanceKm: row.distance_km,
    docsReadyAt: row.docs_ready_at,
    docsRecheckRequired: row.docs_recheck_required,
    keysIssuedAt: row.keys_issued_at,
    odometerEndKm: row.odometer_end_km,
    isAuthor: row.author_id === viewerId,
    authorName: row.employees?.display_name ?? '—',
  };
}

/**
 * Поездки сотрудника для Э1: свои и те, где он указан участником.
 *
 * Два запроса вместо одного с `or`: участие хранится в отдельной таблице, и
 * условие «автор или участник» в PostgREST одним фильтром не выражается.
 */
export async function listMyTrips(employeeId: string): Promise<TripListItem[]> {
  const db = getDb();

  const { data: asParticipant, error: participantError } = await db
    .from('trip_participants')
    .select('trip_id')
    .eq('employee_id', employeeId)
    .returns<{ trip_id: number }[]>();

  if (participantError) {
    throw new Error(`Не удалось прочитать участие: ${participantError.message}`);
  }

  const participantTripIds = (asParticipant ?? []).map((row) => row.trip_id);

  const own = await db
    .from('trips')
    .select(TRIP_SELECT)
    .eq('author_id', employeeId)
    .neq('status', 'draft')
    .order('starts_at', { ascending: false })
    .returns<TripRow[]>();

  if (own.error) {
    throw new Error(`Не удалось прочитать поездки: ${own.error.message}`);
  }

  const rows = [...(own.data ?? [])];

  if (participantTripIds.length > 0) {
    const joined = await db
      .from('trips')
      .select(TRIP_SELECT)
      .in('id', participantTripIds)
      .neq('status', 'draft')
      .order('starts_at', { ascending: false })
      .returns<TripRow[]>();

    if (joined.error) {
      throw new Error(`Не удалось прочитать поездки участника: ${joined.error.message}`);
    }

    // Автор может быть и участником: повторы убираем по номеру.
    const seen = new Set(rows.map((row) => row.id));
    for (const row of joined.data ?? []) {
      if (!seen.has(row.id)) {
        rows.push(row);
      }
    }
  }

  rows.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  return rows.map((row) => toListItem(row, employeeId));
}

interface ParticipantRow {
  employee_id: string;
  employees: NamedRow | null;
}

interface EventRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
  employees: NamedRow | null;
  drivers: { full_name: string } | null;
}

/** Карточка поездки для Э3. `null`, если такой поездки нет. */
export async function getTripCard(tripId: number, viewerId: string): Promise<TripCard | null> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error) {
    throw new Error(`Не удалось прочитать поездку: ${error.message}`);
  }
  if (!trip) {
    return null;
  }

  const { data: participants, error: participantsError } = await db
    .from('trip_participants')
    .select('employee_id, employees(display_name)')
    .eq('trip_id', tripId)
    .returns<ParticipantRow[]>();

  if (participantsError) {
    throw new Error(`Не удалось прочитать участников: ${participantsError.message}`);
  }

  const { data: events, error: eventsError } = await db
    .from('trip_events')
    .select(
      'id, kind, payload, created_at, ' +
        'employees!trip_events_actor_employee_fkey(display_name), ' +
        'drivers!trip_events_actor_driver_fkey(full_name)',
    )
    .eq('trip_id', tripId)
    .order('created_at')
    .returns<EventRow[]>();

  if (eventsError) {
    throw new Error(`Не удалось прочитать журнал: ${eventsError.message}`);
  }

  return {
    ...toListItem(trip, viewerId),
    contract: trip.contract,
    purpose: trip.purpose,
    participants: (participants ?? []).map((row) => ({
      employeeId: row.employee_id,
      displayName: row.employees?.display_name ?? '—',
    })),
    keysReturnedAt: trip.keys_returned_at,
    odometerStartKm: trip.odometer_start_km,
    conditionOk: trip.condition_ok,
    returnNote: trip.return_note,
    cancelledAt: trip.cancelled_at,
    events: (events ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      actorName: row.employees?.display_name ?? row.drivers?.full_name ?? null,
      payload: row.payload,
    })),
  };
}
