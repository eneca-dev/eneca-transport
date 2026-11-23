import 'server-only';

import { getDb } from '@/config/supabase';
import { minskDayBounds } from '@/modules/trips/booking';
import { conflictList, lateReturnConflicts } from '@/modules/trips/bookingConflicts';

/**
 * Экран рецепции (Э4): что сегодня выдать и что принять.
 *
 * Четыре списка, как в требованиях. Выдачи и возвраты — минские сутки, а не
 * сутки по UTC. Просроченные показываются все, включая прошлые дни: ключи,
 * не сданные позавчера, не должны исчезнуть с экрана.
 */

export interface ReceptionTrip {
  id: number;
  startsAt: string;
  endsAt: string;
  route: string;
  authorName: string;
  carLabel: string | null;
  driverName: string | null;
  needsDriver: boolean;
  /** Документы готовы и не требуют повторной проверки. */
  docsReady: boolean;
  docsRecheckRequired: boolean;
  keysIssuedAt: string | null;
  odometerStartKm: number | null;
  odometerEndKm: number | null;
  /**
   * Чем занята машина или водитель, если принять ключи сейчас нельзя.
   * `null` — ничего не мешает. Считается только для просроченных: у возврата
   * в срок наложиться не на что.
   */
  blockedBy: string | null;
}

export interface ReceptionDay {
  /** Выдачи: заявки, которым пора ехать, а ключи ещё не выданы. */
  issues: ReceptionTrip[];
  /** Возвраты, плановое время которых приходится на сегодня. */
  returns: ReceptionTrip[];
  /** Поездки, у которых плановое время возврата прошло, а ключи не сданы. */
  overdue: ReceptionTrip[];
}

interface Row {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  needs_driver: boolean;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  keys_issued_at: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  car_id: string | null;
  driver_id: string | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, needs_driver, docs_ready_at, docs_recheck_required, ' +
  'keys_issued_at, odometer_start_km, odometer_end_km, car_id, driver_id, ' +
  'cars(plate, model), drivers(full_name), employees!trips_author_id_fkey(display_name)';

function toTrip(row: Row): ReceptionTrip {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    route: row.route,
    authorName: row.employees?.display_name ?? '—',
    carLabel: row.cars ? `${row.cars.model} ${row.cars.plate}` : null,
    driverName: row.drivers?.full_name ?? null,
    needsDriver: row.needs_driver,
    docsReady: row.docs_ready_at !== null && !row.docs_recheck_required,
    docsRecheckRequired: row.docs_recheck_required,
    keysIssuedAt: row.keys_issued_at,
    odometerStartKm: row.odometer_start_km,
    odometerEndKm: row.odometer_end_km,
    blockedBy: null,
  };
}

/**
 * Чем занята машина просроченной поездки, если принимать ключи прямо сейчас.
 *
 * Спрашивается только у просроченных: занятый интервал поездки, вернувшейся в
 * срок, не выходит за плановое время и наложиться ни на что не может.
 *
 * Проверка идёт до нажатия, а не после отказа: кнопка «Принять» выглядит
 * рабочей, и человек узнавал причину только ошибкой, уже нажав.
 */
async function withConflicts(trips: ReceptionTrip[], rows: Row[], now: Date): Promise<void> {
  await Promise.all(
    trips.map(async (trip, index) => {
      const row = rows[index];

      // Без показания одометра кнопка и так неактивна, и причина у неё другая.
      if (trip.odometerEndKm === null) {
        return;
      }

      const conflicts = await lateReturnConflicts(
        {
          id: trip.id,
          carId: row.car_id,
          driverId: row.driver_id,
          startsAt: trip.startsAt,
        },
        now,
      );

      if (conflicts.length > 0) {
        trip.blockedBy = conflictList(conflicts);
      }
    }),
  );
}

export async function listReceptionDay(now = new Date()): Promise<ReceptionDay> {
  const db = getDb();
  const { to } = minskDayBounds(now);
  const nowIso = now.toISOString();

  // Выдачи: всё, чей выезд уже наступил или наступит сегодня, но ключи не
  // выданы. Прошедшие не убираем — иначе забытая выдача исчезнет с экрана.
  const issues = await db
    .from('trips')
    .select(SELECT)
    .in('status', ['booked', 'docs_ready'])
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .returns<Row[]>();

  if (issues.error) {
    throw new Error(`Не удалось прочитать выдачи: ${issues.error.message}`);
  }

  const inTrip = await db
    .from('trips')
    .select(SELECT)
    .eq('status', 'in_trip')
    .order('ends_at')
    .returns<Row[]>();

  if (inTrip.error) {
    throw new Error(`Не удалось прочитать поездки в пути: ${inTrip.error.message}`);
  }

  const returns: ReceptionTrip[] = [];
  const overdue: ReceptionTrip[] = [];
  const overdueRows: Row[] = [];

  for (const row of inTrip.data ?? []) {
    const trip = toTrip(row);
    // Просрочка важнее принадлежности к сегодняшнему дню: поездка, которую
    // должны были вернуть утром, нужна рецепции в списке просроченных.
    if (row.ends_at < nowIso) {
      overdue.push(trip);
      overdueRows.push(row);
    } else if (row.ends_at < to.toISOString()) {
      returns.push(trip);
    }
  }

  await withConflicts(overdue, overdueRows, now);

  return {
    issues: (issues.data ?? []).map(toTrip),
    returns,
    overdue,
  };
}
