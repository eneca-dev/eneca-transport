import 'server-only';

import { getDb } from '@/config/supabase';
import { minskDayBounds } from '@/modules/trips/booking';

/**
 * История поездок (Э7) — закрытые и отменённые поездки за период, с фильтрами.
 *
 * Отменённые показываются тоже: АХО по ним видит, что бронь была и освободилась,
 * а без них история выглядит так, будто заявки не существовало.
 */

export interface HistoryFilters {
  /** Границы периода минскими датами, «2026-11-01». */
  since: string;
  until: string;
  carId?: string;
  employeeId?: string;
  /**
   * Отдел автора заявки, как он записан в Entra ID. Строкой, а не кодом:
   * справочника отделов у нас нет, в `employees.department` лежит название.
   */
  department?: string;
}

export interface HistoryRow {
  id: number;
  status: 'closed' | 'cancelled';
  startsAt: string;
  endsAt: string;
  route: string;
  authorName: string;
  driverName: string | null;
  carLabel: string | null;
  distanceKm: number | null;
  returnNote: string | null;
  conditionOk: boolean | null;
}

export interface HistoryResult {
  rows: HistoryRow[];
  /** Сумма пробега по показанным поездкам. */
  totalKm: number;
}

interface Row {
  id: number;
  status: 'closed' | 'cancelled';
  starts_at: string;
  ends_at: string;
  route: string;
  author_id: string;
  distance_km: number | null;
  return_note: string | null;
  condition_ok: boolean | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { display_name: string; department: string | null } | null;
}

const SELECT =
  'id, status, starts_at, ends_at, route, author_id, distance_km, return_note, condition_ok, ' +
  'cars(plate, model), drivers(full_name), ' +
  'employees!trips_author_id_fkey(display_name, department)';

/**
 * Поездки за период.
 *
 * Фильтр по сотруднику смотрит и на автора, и на участников: «поездки Петрова»
 * — это те, где он ехал, а не только те, которые он оформлял.
 *
 * Фильтр по отделу — наоборот, только по автору: в поездку берут коллег из
 * других отделов, и «поездки проектного отдела» — это те, которые он заказал.
 */
export async function listHistory(filters: HistoryFilters): Promise<HistoryResult> {
  const db = getDb();

  const from = minskDayBounds(new Date(`${filters.since}T12:00:00+03:00`)).from;
  const to = minskDayBounds(new Date(`${filters.until}T12:00:00+03:00`)).to;

  let request = db
    .from('trips')
    .select(SELECT)
    .in('status', ['closed', 'cancelled'])
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: false });

  if (filters.carId) {
    request = request.eq('car_id', filters.carId);
  }

  // Отдел живёт у автора, поэтому условие ставится на связанную таблицу.
  // `!inner` обязателен: без него PostgREST вернёт поездку с пустым автором
  // вместо того, чтобы её отбросить.
  if (filters.department) {
    request = request
      .select(SELECT.replace('employees!trips_author_id_fkey', 'employees!inner'))
      .eq('employees.department', filters.department);
  }

  const { data, error } = await request.returns<Row[]>();

  if (error) {
    throw new Error(`Не удалось прочитать историю: ${error.message}`);
  }

  let rows = data ?? [];

  if (filters.employeeId) {
    const { data: asParticipant, error: participantError } = await db
      .from('trip_participants')
      .select('trip_id')
      .eq('employee_id', filters.employeeId)
      .returns<{ trip_id: number }[]>();

    if (participantError) {
      throw new Error(`Не удалось прочитать участие: ${participantError.message}`);
    }

    const participantTrips = new Set((asParticipant ?? []).map((row) => row.trip_id));
    rows = rows.filter(
      (row) => row.author_id === filters.employeeId || participantTrips.has(row.id),
    );
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      route: row.route,
      authorName: row.employees?.display_name ?? '—',
      driverName: row.drivers?.full_name ?? null,
      carLabel: row.cars ? `${row.cars.model} ${row.cars.plate}` : null,
      distanceKm: row.distance_km,
      returnNote: row.return_note,
      conditionOk: row.condition_ok,
    })),
    totalKm: rows.reduce((sum, row) => sum + (row.distance_km ?? 0), 0),
  };
}

export interface FilterOption {
  id: string;
  label: string;
}

/** Машины, сотрудники и отделы для выпадающих списков фильтров. */
export async function listHistoryFilters(): Promise<{
  cars: FilterOption[];
  employees: FilterOption[];
  departments: string[];
}> {
  const db = getDb();

  const cars = await db
    .from('cars')
    .select('id, plate, model')
    .order('plate')
    .returns<{ id: string; plate: string; model: string }[]>();

  if (cars.error) {
    throw new Error(`Не удалось прочитать машины: ${cars.error.message}`);
  }

  // Сотрудники только те, кто действительно ездил: весь справочник из
  // девятисот человек в выпадающем списке бесполезен.
  const authors = await db
    .from('trips')
    .select('author_id, employees!trips_author_id_fkey(display_name, department)')
    .in('status', ['closed', 'cancelled'])
    .returns<
      { author_id: string; employees: { display_name: string; department: string | null } | null }[]
    >();

  if (authors.error) {
    throw new Error(`Не удалось прочитать авторов: ${authors.error.message}`);
  }

  const unique = new Map<string, string>();
  const departments = new Set<string>();

  for (const row of authors.data ?? []) {
    if (row.employees) {
      unique.set(row.author_id, row.employees.display_name);
      if (row.employees.department) {
        departments.add(row.employees.department);
      }
    }
  }

  return {
    cars: (cars.data ?? []).map((car) => ({
      id: car.id,
      label: `${car.model} ${car.plate}`,
    })),
    employees: [...unique.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    departments: [...departments].sort((a, b) => a.localeCompare(b, 'ru')),
  };
}
