import 'server-only';

import { getDb } from '@/config/supabase';
import { formatPeriod } from '@/lib/datetime';
import { REASON_LABEL } from '@/modules/drivers/queries';
import { minskDayBounds, toMinskDate } from '@/modules/trips/booking';

import { capitalize, clip, dateRange, datesBetween } from './spans';

import type { UnavailabilityReason } from '@/modules/drivers/queries';

/**
 * Календарь занятости (Э6): машины и водители по дням.
 *
 * Отдаются не ячейки по дням, а **отрезки**: «с 25 по 26 ноября занята
 * поездкой #127». Так календарь рисует многодневную занятость одной полосой,
 * а не повторяет одну и ту же подпись в каждой клетке.
 *
 * Подписи в отрезке нет: цвет говорит, что это, а подробности показываются
 * подсказкой. Слово «ремонт» в клетке шириной в два символа всё равно не
 * читается, зато занимает всю колонку.
 *
 * Занятость считается по минским суткам: поездка с 23:00 до 01:00 занимает два
 * дня, и в календаре должна быть видна в оба.
 */

export type SpanKind = 'trip' | 'repair' | 'away';

export interface CalendarSpan {
  key: string;
  kind: SpanKind;
  /** Номер поездки — только у занятости поездкой, по нему открывается Э3. */
  tripId: number | null;
  /** Первый и последний день отрезка в пределах показанного периода. */
  from: string;
  to: string;
  /** Отрезок начался раньше периода или кончится позже — рисуем срезанным. */
  openStart: boolean;
  openEnd: boolean;
  /** Первая строка подсказки: «#127 · Минск → Гомель → Минск». */
  title: string;
  /** Вторая: «25.11 07:00 – 26.11 19:00» или «02.12 – 09.12». */
  when: string;
  /** Третья: машина и водитель, примечание ремонта, причина отсутствия. */
  detail: string | null;
}

export interface CalendarRow {
  id: string;
  title: string;
  subtitle: string | null;
  spans: CalendarSpan[];
}

export interface CalendarData {
  /** Подряд идущие минские даты периода. */
  dates: string[];
  cars: CalendarRow[];
  drivers: CalendarRow[];
}

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  car_id: string | null;
  driver_id: string | null;
  cars: { model: string; plate: string } | null;
  drivers: { full_name: string } | null;
}

interface RepairRow {
  car_id: string;
  since: string;
  until: string | null;
  note: string | null;
}

interface AwayRow {
  driver_id: string;
  since: string;
  until: string;
  reason: UnavailabilityReason;
  note: string | null;
}

const TRIP_SELECT =
  'id, starts_at, ends_at, route, car_id, driver_id, cars(model, plate), drivers(full_name)';

export async function loadCalendar(since: string, until: string): Promise<CalendarData> {
  const db = getDb();
  const dates = datesBetween(since, until);

  if (dates.length === 0) {
    return { dates: [], cars: [], drivers: [] };
  }

  const from = minskDayBounds(new Date(`${since}T12:00:00+03:00`)).from;
  const to = minskDayBounds(new Date(`${until}T12:00:00+03:00`)).to;

  const cars = await db
    .from('cars')
    .select('id, plate, model')
    .eq('is_active', true)
    .order('plate')
    .returns<{ id: string; plate: string; model: string }[]>();

  const drivers = await db
    .from('drivers')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name')
    .returns<{ id: string; full_name: string }[]>();

  if (cars.error || drivers.error) {
    throw new Error(`Не удалось прочитать справочники: ${(cars.error ?? drivers.error)!.message}`);
  }

  // Занимают календарь только живые брони: черновиков нет, отменённые и
  // закрытые не занимают машину.
  const trips = await db
    .from('trips')
    .select(TRIP_SELECT)
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .lt('starts_at', to.toISOString())
    .gte('ends_at', from.toISOString())
    .order('starts_at')
    .returns<TripRow[]>();

  const repairs = await db
    .from('car_repairs')
    .select('car_id, since, until, note')
    .or(`until.is.null,until.gte.${since}`)
    .lte('since', until)
    .order('since')
    .returns<RepairRow[]>();

  const away = await db
    .from('driver_unavailability')
    .select('driver_id, since, until, reason, note')
    .lte('since', until)
    .gte('until', since)
    .order('since')
    .returns<AwayRow[]>();

  if (trips.error || repairs.error || away.error) {
    throw new Error(
      `Не удалось прочитать занятость: ${(trips.error ?? repairs.error ?? away.error)!.message}`,
    );
  }

  const carRows: CalendarRow[] = (cars.data ?? []).map((car) => ({
    id: car.id,
    title: car.model,
    subtitle: car.plate,
    spans: [],
  }));

  const driverRows: CalendarRow[] = (drivers.data ?? []).map((driver) => ({
    id: driver.id,
    title: driver.full_name,
    subtitle: null,
    spans: [],
  }));

  const byId = new Map<string, CalendarRow>(
    [...carRows, ...driverRows].map((row) => [row.id, row]),
  );

  const put = (id: string | null, span: CalendarSpan) => {
    if (!id) return;
    byId.get(id)?.spans.push(span);
  };

  for (const trip of trips.data ?? []) {
    const bounds = clip(toMinskDate(new Date(trip.starts_at)), toMinskDate(new Date(trip.ends_at)), dates);

    if (!bounds) {
      continue;
    }

    const car = trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : 'машина не выбрана';
    const driver = trip.drivers ? trip.drivers.full_name : 'без водителя';

    const span: CalendarSpan = {
      key: `trip-${trip.id}`,
      kind: 'trip',
      tripId: trip.id,
      ...bounds,
      title: trip.route,
      when: formatPeriod(new Date(trip.starts_at), new Date(trip.ends_at)),
      detail: `${car} · ${driver}`,
    };

    put(trip.car_id, span);
    put(trip.driver_id, span);
  }

  for (const repair of repairs.data ?? []) {
    const bounds = clip(repair.since, repair.until, dates);

    if (!bounds) {
      continue;
    }

    put(repair.car_id, {
      key: `repair-${repair.car_id}-${repair.since}`,
      kind: 'repair',
      tripId: null,
      ...bounds,
      title: 'Ремонт',
      when: dateRange(repair.since, repair.until),
      detail: repair.note,
    });
  }

  for (const period of away.data ?? []) {
    const bounds = clip(period.since, period.until, dates);

    if (!bounds) {
      continue;
    }

    put(period.driver_id, {
      key: `away-${period.driver_id}-${period.since}`,
      kind: 'away',
      tripId: null,
      ...bounds,
      title: capitalize(REASON_LABEL[period.reason]),
      when: dateRange(period.since, period.until),
      detail: period.note,
    });
  }

  return { dates, cars: carRows, drivers: driverRows };
}
