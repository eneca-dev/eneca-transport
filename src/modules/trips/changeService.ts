import 'server-only';

import { getDb } from '@/config/supabase';
import { formatPeriod } from '@/lib/datetime';
import { notifyFinanceNewRequest } from '@/modules/documents/notify';

import { notifyDriverAssigned } from './notifyDriver';
import { notifyTripChanged } from './notifyChange';

/**
 * Перенос и отмена заявки.
 *
 * Оба действия доступны только до выдачи ключей — это инвариант требований.
 * После выдачи поездка идёт своим ходом: отменять выданную машину бессмысленно,
 * её нужно принять.
 *
 * Непересечение броней держит база. Здесь только перевод её отказа в текст:
 * между выбором новых дат и записью машину может занять кто-то другой.
 */

export type ChangeOutcome = { ok: true } | { ok: false; reason: string };

interface TripRow {
  id: number;
  status: string;
  author_id: string;
  starts_at: string;
  ends_at: string;
  needs_driver: boolean;
  driver_id: string | null;
  keys_issued_at: string | null;
}

const SELECT =
  'id, status, author_id, starts_at, ends_at, needs_driver, driver_id, keys_issued_at';

async function loadTrip(tripId: number): Promise<TripRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error) {
    throw new Error(`Не удалось прочитать поездку #${tripId}: ${error.message}`);
  }
  return data;
}

/** Общая проверка: менять заявку можно, пока ключи не выданы. */
function guard(trip: TripRow | null): ChangeOutcome {
  if (!trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }
  if (trip.status === 'cancelled') {
    return { ok: false, reason: 'Поездка уже отменена.' };
  }
  if (trip.keys_issued_at !== null || !['booked', 'docs_ready'].includes(trip.status)) {
    return { ok: false, reason: 'Ключи уже выданы — перенести или отменить нельзя.' };
  }
  return { ok: true };
}

/** Отменить заявку. Машину и водителя освобождает триггер базы. */
export async function cancelTrip(tripId: number, employeeId: string): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok) {
    return allowed;
  }

  const db = getDb();
  const now = new Date().toISOString();

  const { data: updated, error } = await db
    .from('trips')
    .update({ status: 'cancelled', cancelled_at: now, cancelled_by: employeeId, updated_at: now })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось отменить`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }
  if ((updated ?? []).length === 0) {
    return { ok: false, reason: 'Поездка только что изменилась. Обновите экран.' };
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'cancelled',
    payload: {},
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'cancelled',
    'Поездка отменена, автомобиль и водитель свободны',
    'cancelled',
  );

  return { ok: true };
}

export interface RescheduleInput {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Перенести заявку на другое время.
 *
 * Если у поездки есть водитель, перенос сбрасывает его подтверждение: по
 * требованиям изменение времени требует нового подтверждения за 15 минут.
 * Документы уходят на повторную проверку — прежний комплект выписан на старые
 * даты.
 */
export async function rescheduleTrip(
  tripId: number,
  employeeId: string,
  input: RescheduleInput,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }

  if (input.endsAt <= input.startsAt) {
    return { ok: false, reason: 'Возврат должен быть позже выезда.' };
  }
  if (input.endsAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'Новое время уже прошло. Проверьте даты.' };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const hasDriver = trip.needs_driver && trip.driver_id !== null;

  const { data: updated, error } = await db
    .from('trips')
    .update({
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      // Прежний комплект документов выписан на старые даты.
      docs_recheck_required: true,
      // Новое время — новое подтверждение, отсчёт 15 минут начинается заново.
      ...(hasDriver
        ? { driver_confirmation: 'pending', driver_assigned_at: now }
        : {}),
      updated_at: now,
    })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    // 23P01 — ограничение непересечения: новые даты заняты.
    if (error.code === '23P01') {
      const reason = error.message.includes('trips_driver_no_overlap')
        ? 'На это время водитель занят другой поездкой. Выберите другое время.'
        : 'На это время машина занята. Выберите другое время или другую машину.';
      return { ok: false, reason };
    }
    console.error(`Поездка #${tripId}: не удалось перенести`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  if ((updated ?? []).length === 0) {
    return { ok: false, reason: 'Поездка только что изменилась. Обновите экран.' };
  }

  const was = formatPeriod(new Date(trip.starts_at), new Date(trip.ends_at));
  const became = formatPeriod(input.startsAt, input.endsAt);

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'rescheduled',
    payload: { was, became },
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'rescheduled',
    `Время: было ${was}, стало ${became}`,
    // В ключ входит новое время: два переноса подряд — два сообщения.
    `rescheduled:${input.startsAt.toISOString()}`,
    hasDriver,
  );

  // Новый запрос подтверждения водителю и повторная проверка документов.
  if (hasDriver) {
    await notifyDriverAssigned(tripId);
  }
  await notifyFinanceNewRequest(tripId, `recheck:${now}`);

  return { ok: true };
}
