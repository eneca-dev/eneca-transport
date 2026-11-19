import 'server-only';

import { getDb } from '@/config/supabase';

import { bookingRange, freeFrom, toMinskDate } from './booking';

import type { UnavailabilityReason } from '@/modules/drivers/queries';

/**
 * Что свободно на выбранные даты — для шага 2 в Э2.
 *
 * Возвращаются все машины и водители, а не только свободные: по требованиям
 * занятые показываются в списке с причиной («занят до 05.11 12:00»,
 * «недоступен (болезнь)»), чтобы человек видел, почему выбора нет.
 *
 * Причина возвращается разобранной, а не готовой строкой: формулировать и
 * форматировать даты — дело экрана, у него есть часовой пояс и падежи.
 */

/** Почему вариант недоступен. */
export type Blocker =
  | { kind: 'repair'; note: string | null }
  | { kind: 'busy'; freeFrom: string }
  | { kind: 'away'; reason: UnavailabilityReason; until: string };

export interface CarOption {
  id: string;
  plate: string;
  model: string;
  odometerKm: number;
  blocked: Blocker | null;
}

export interface DriverOption {
  id: string;
  fullName: string;
  /** Без привязки Telegram водитель не получит Т1 — экран об этом предупреждает. */
  telegramLinked: boolean;
  blocked: Blocker | null;
}

interface ConflictRow {
  id: number;
  car_id: string | null;
  driver_id: string | null;
  ends_at: string;
  keys_returned_at: string | null;
  status: string;
}

interface CarRow {
  id: string;
  plate: string;
  model: string;
  odometer_km: number;
  in_repair: boolean;
}

interface DriverRow {
  id: string;
  full_name: string;
  telegram_linked: boolean;
}

interface OpenRepairRow {
  car_id: string;
  note: string | null;
}

interface AwayRow {
  driver_id: string;
  until: string;
  reason: UnavailabilityReason;
}

export interface AvailabilityOptions {
  /**
   * Поездка, которую переносят: её собственная бронь не считается занятостью,
   * иначе машину нельзя будет оставить прежней.
   */
  exceptTripId?: number;
}

/**
 * Брони, пересекающиеся с интервалом новой поездки. Одним запросом на машины и
 * водителей: занятость у них считается от одного и того же интервала.
 */
async function loadConflicts(
  startsAt: Date,
  endsAt: Date,
  options: AvailabilityOptions,
): Promise<ConflictRow[]> {
  let request = getDb()
    .from('trips')
    .select('id, car_id, driver_id, ends_at, keys_returned_at, status')
    .overlaps('booking_during', bookingRange(startsAt, endsAt));

  if (options.exceptTripId !== undefined) {
    request = request.neq('id', options.exceptTripId);
  }

  const { data, error } = await request.returns<ConflictRow[]>();

  if (error) {
    throw new Error(`Не удалось проверить занятость: ${error.message}`);
  }
  return data ?? [];
}

/**
 * С какого момента освободится машина после этой поездки. У закрытой поездки
 * буфер считается от фактического возврата — так же, как в триггере базы.
 */
function conflictFreeFrom(row: ConflictRow): Date {
  const base =
    row.status === 'closed' && row.keys_returned_at
      ? new Date(row.keys_returned_at)
      : new Date(row.ends_at);
  return freeFrom(base);
}

/** Самое позднее освобождение среди пересекающихся броней. */
function latestFreeFrom(rows: ConflictRow[]): string {
  const moments = rows.map((row) => conflictFreeFrom(row).getTime());
  return new Date(Math.max(...moments)).toISOString();
}

export async function listCarOptions(
  startsAt: Date,
  endsAt: Date,
  options: AvailabilityOptions = {},
): Promise<CarOption[]> {
  const db = getDb();

  const { data: cars, error } = await db
    .from('v_cars')
    .select('id, plate, model, odometer_km, in_repair')
    .eq('is_active', true)
    .order('plate')
    .returns<CarRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать машины: ${error.message}`);
  }

  const { data: repairs, error: repairsError } = await db
    .from('car_repairs')
    .select('car_id, note')
    .is('until', null)
    .returns<OpenRepairRow[]>();

  if (repairsError) {
    throw new Error(`Не удалось прочитать ремонты: ${repairsError.message}`);
  }

  const conflicts = await loadConflicts(startsAt, endsAt, options);

  const repairNotes = new Map((repairs ?? []).map((row) => [row.car_id, row.note]));
  const busy = new Map<string, ConflictRow[]>();
  for (const row of conflicts) {
    if (!row.car_id) continue;
    busy.set(row.car_id, [...(busy.get(row.car_id) ?? []), row]);
  }

  return (cars ?? []).map((car) => {
    // Ремонт важнее занятости: машина в ремонте не поедет и в свободные даты.
    const blocked: Blocker | null = car.in_repair
      ? { kind: 'repair', note: repairNotes.get(car.id) ?? null }
      : busy.has(car.id)
        ? { kind: 'busy', freeFrom: latestFreeFrom(busy.get(car.id)!) }
        : null;

    return {
      id: car.id,
      plate: car.plate,
      model: car.model,
      odometerKm: car.odometer_km,
      blocked,
    };
  });
}

export async function listDriverOptions(
  startsAt: Date,
  endsAt: Date,
  options: AvailabilityOptions = {},
): Promise<DriverOption[]> {
  const db = getDb();

  const { data: drivers, error } = await db
    .from('v_drivers')
    .select('id, full_name, telegram_linked')
    .eq('is_active', true)
    .order('full_name')
    .returns<DriverRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать водителей: ${error.message}`);
  }

  // Периоды недоступности хранятся датами без времени, поэтому сравниваются с
  // минским днём поездки, а не с днём по UTC.
  const { data: away, error: awayError } = await db
    .from('driver_unavailability')
    .select('driver_id, until, reason')
    .lte('since', toMinskDate(endsAt))
    .gte('until', toMinskDate(startsAt))
    .returns<AwayRow[]>();

  if (awayError) {
    throw new Error(`Не удалось прочитать недоступность водителей: ${awayError.message}`);
  }

  const conflicts = await loadConflicts(startsAt, endsAt, options);

  const awayByDriver = new Map((away ?? []).map((row) => [row.driver_id, row]));
  const busy = new Map<string, ConflictRow[]>();
  for (const row of conflicts) {
    if (!row.driver_id) continue;
    busy.set(row.driver_id, [...(busy.get(row.driver_id) ?? []), row]);
  }

  return (drivers ?? []).map((driver) => {
    const awayPeriod = awayByDriver.get(driver.id);

    // Недоступность важнее занятости: болеющего не назначить и на свободные дни.
    const blocked: Blocker | null = awayPeriod
      ? { kind: 'away', reason: awayPeriod.reason, until: awayPeriod.until }
      : busy.has(driver.id)
        ? { kind: 'busy', freeFrom: latestFreeFrom(busy.get(driver.id)!) }
        : null;

    return {
      id: driver.id,
      fullName: driver.full_name,
      telegramLinked: driver.telegram_linked,
      blocked,
    };
  });
}
