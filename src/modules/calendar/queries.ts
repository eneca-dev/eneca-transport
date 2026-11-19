import 'server-only';

import { getDb } from '@/config/supabase';
import { minskDayBounds, toMinskDate } from '@/modules/trips/booking';

/**
 * Календарь занятости (Э6): машины и водители по дням.
 *
 * Строки — машины, потом водители. В ячейке либо номер поездки, либо ремонт,
 * либо недоступность. Пустая ячейка значит, что в этот день свободно.
 *
 * Занятость считается по минским суткам: поездка с 23:00 до 01:00 занимает два
 * дня, и в календаре должна быть видна в оба.
 */

export type CellKind = 'trip' | 'repair' | 'away';

export interface CalendarCell {
  kind: CellKind;
  /** Номер поездки — только для занятости поездкой. */
  tripId?: number;
  /** Что показать в ячейке: «#127», «ремонт», «болезнь». */
  label: string;
}

export interface CalendarRow {
  id: string;
  title: string;
  subtitle: string | null;
  /** Ключ — минская дата «2026-11-05». */
  days: Record<string, CalendarCell[]>;
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
  status: string;
  car_id: string | null;
  driver_id: string | null;
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
  reason: 'sick' | 'vacation' | 'other';
}

const REASON_LABEL: Record<AwayRow['reason'], string> = {
  sick: 'болезнь',
  vacation: 'отпуск',
  other: 'недоступен',
};

/** Все минские даты от начала до конца включительно. */
function datesBetween(since: string, until: string): string[] {
  const dates: string[] = [];
  let cursor = minskDayBounds(new Date(`${since}T12:00:00+03:00`)).from;
  const last = minskDayBounds(new Date(`${until}T12:00:00+03:00`)).from;

  // Защита от бесконечного цикла при перевёрнутом периоде.
  while (cursor <= last && dates.length < 120) {
    dates.push(toMinskDate(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}

/** Минские сутки, которые занимает интервал поездки. */
function tripDays(startsAt: string, endsAt: string, dates: string[]): string[] {
  const first = toMinskDate(new Date(startsAt));
  const last = toMinskDate(new Date(endsAt));
  return dates.filter((date) => date >= first && date <= last);
}

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
    throw new Error(
      `Не удалось прочитать справочники: ${(cars.error ?? drivers.error)!.message}`,
    );
  }

  // Занимают календарь только живые брони: черновиков нет, отменённые и
  // закрытые не занимают машину.
  const trips = await db
    .from('trips')
    .select('id, starts_at, ends_at, status, car_id, driver_id')
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .lt('starts_at', to.toISOString())
    .gte('ends_at', from.toISOString())
    .returns<TripRow[]>();

  const repairs = await db
    .from('car_repairs')
    .select('car_id, since, until, note')
    .or(`until.is.null,until.gte.${since}`)
    .lte('since', until)
    .returns<RepairRow[]>();

  const away = await db
    .from('driver_unavailability')
    .select('driver_id, since, until, reason')
    .lte('since', until)
    .gte('until', since)
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
    days: {},
  }));

  const driverRows: CalendarRow[] = (drivers.data ?? []).map((driver) => ({
    id: driver.id,
    title: driver.full_name,
    subtitle: null,
    days: {},
  }));

  const byId = new Map<string, CalendarRow>(
    [...carRows, ...driverRows].map((row) => [row.id, row]),
  );

  const put = (id: string | null, date: string, cell: CalendarCell) => {
    if (!id) return;
    const row = byId.get(id);
    if (!row) return;
    row.days[date] = [...(row.days[date] ?? []), cell];
  };

  for (const trip of trips.data ?? []) {
    const cell: CalendarCell = { kind: 'trip', tripId: trip.id, label: `#${trip.id}` };
    for (const date of tripDays(trip.starts_at, trip.ends_at, dates)) {
      put(trip.car_id, date, cell);
      put(trip.driver_id, date, cell);
    }
  }

  for (const repair of repairs.data ?? []) {
    for (const date of dates) {
      if (date >= repair.since && (repair.until === null || date <= repair.until)) {
        put(repair.car_id, date, { kind: 'repair', label: 'ремонт' });
      }
    }
  }

  for (const period of away.data ?? []) {
    for (const date of dates) {
      if (date >= period.since && date <= period.until) {
        put(period.driver_id, date, { kind: 'away', label: REASON_LABEL[period.reason] });
      }
    }
  }

  return { dates, cars: carRows, drivers: driverRows };
}
