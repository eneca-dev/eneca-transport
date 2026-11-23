import 'server-only';

import { getDb } from '@/config/supabase';

import { lateReturnConflicts, lateReturnReason } from './bookingConflicts';
import { notifyDriverTripClosed } from './notifyDriverReturn';
import { notifyAhoOdometerTooLow, notifyAhoRemark, notifyTripClosed } from './notifyReturn';

/**
 * Возврат поездки: показание одометра, состояние, примечание, приём ключей.
 *
 * Отдельно от Server Action, потому что тот же возврат оформляет водитель в
 * Telegram, где токена вкладки нет. Условия должны быть одни: разойдутся — и
 * пробег посчитается по-разному в зависимости от того, кто сдавал машину.
 */

export interface ReturnInput {
  odometerKm: number;
  /** false — есть замечание по машине. */
  conditionOk: boolean;
  note: string;
}

export type ReturnOutcome =
  | { ok: true }
  | { ok: false; reason: string };

interface TripRow {
  id: number;
  status: string;
  car_id: string | null;
  author_id: string;
  driver_id: string | null;
  starts_at: string;
  ends_at: string;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
}

const TRIP_SELECT =
  'id, status, car_id, author_id, driver_id, starts_at, ends_at, ' +
  'odometer_start_km, odometer_end_km';

/** Кто оформляет возврат: сотрудник во вкладке или водитель в Telegram. */
export type ReturnActor = { employeeId: string } | { driverId: string };

/**
 * Принять показание одометра и состояние машины.
 *
 * Поездка при этом не закрывается: по требованиям закрывает её рецепция, когда
 * принимает ключи. Возврат лишь появляется на её экране, и ждать планового
 * времени для этого не нужно — досрочный возврат оформляется так же.
 */
export async function submitReturn(
  tripId: number,
  actor: ReturnActor,
  input: ReturnInput,
): Promise<ReturnOutcome> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }
  if (trip.status !== 'in_trip') {
    return {
      ok: false,
      reason:
        trip.status === 'closed'
          ? 'Поездка уже закрыта.'
          : 'Ключи ещё не выданы — возвращать нечего.',
    };
  }
  if (trip.odometer_start_km === null) {
    // Такого быть не должно: снимок ставится при выдаче ключей. Но если его
    // нет, считать пробег не от чего, и молча писать значение нельзя.
    return { ok: false, reason: 'У поездки нет начального показания. Обратитесь в АХО.' };
  }

  // Требование: значение меньше начального не сохраняется, человек вводит
  // заново, а АХО получает К11. Пробег не может быть отрицательным.
  if (input.odometerKm < trip.odometer_start_km) {
    await notifyAhoOdometerTooLow(tripId, input.odometerKm, actor);
    return {
      ok: false,
      reason:
        `Показание меньше начального (${trip.odometer_start_km.toLocaleString('ru-RU')} км). ` +
        'Проверьте цифры на приборной панели и введите снова.',
    };
  }

  const now = new Date().toISOString();

  const { error: updateError } = await db
    .from('trips')
    .update({
      odometer_end_km: input.odometerKm,
      condition_ok: input.conditionOk,
      return_note: input.note.trim() || null,
      updated_at: now,
    })
    .eq('id', tripId)
    .eq('status', 'in_trip');

  if (updateError) {
    console.error(`Поездка #${tripId}: не удалось записать возврат`, updateError);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  // История показаний: сюда же потом лягут исправления после закрытия.
  const { error: readingError } = await db.from('odometer_readings').insert({
    trip_id: tripId,
    car_id: trip.car_id,
    kind: 'return',
    value_km: input.odometerKm,
    entered_by_employee: 'employeeId' in actor ? actor.employeeId : null,
    entered_by_driver: 'driverId' in actor ? actor.driverId : null,
  });

  if (readingError) {
    console.error(`Поездка #${tripId}: показание не попало в историю`, readingError);
  }

  const { error: eventError } = await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'return_submitted',
    payload: {
      odometer_end_km: input.odometerKm,
      condition_ok: input.conditionOk,
    },
    actor_employee: 'employeeId' in actor ? actor.employeeId : null,
    actor_driver: 'driverId' in actor ? actor.driverId : null,
  });

  if (eventError) {
    console.error(`Поездка #${tripId}: событие о возврате не записано`, eventError);
  }

  // К10 уходит и на замечание, и на примечание: АХО решает, что с этим делать.
  if (!input.conditionOk || input.note.trim()) {
    await notifyAhoRemark(tripId);
  }

  return { ok: true };
}

/**
 * Приём ключей на рецепции: поездка закрывается.
 *
 * Здесь же текущее показание машины становится равным сданному: оно станет
 * начальным для следующей поездки. Остаток брони освобождается триггером базы,
 * который пересчитывает занятый интервал от фактического возврата.
 */
export async function acceptKeys(tripId: number, employeeId: string): Promise<ReturnOutcome> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(TRIP_SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }
  if (trip.status === 'closed') {
    return { ok: false, reason: 'Поездка уже закрыта.' };
  }
  if (trip.status !== 'in_trip') {
    return { ok: false, reason: 'Ключи по этой поездке не выдавались.' };
  }
  // Инвариант требований: поездку нельзя закрыть без показания одометра.
  if (trip.odometer_end_km === null) {
    return {
      ok: false,
      reason: 'Нет показания одометра. Дождитесь, пока его передаст автор или водитель.',
    };
  }

  const now = new Date().toISOString();

  const { data: closed, error: closeError } = await db
    .from('trips')
    .update({
      status: 'closed',
      keys_returned_at: now,
      keys_returned_by: employeeId,
      closed_at: now,
      updated_at: now,
    })
    .eq('id', tripId)
    .eq('status', 'in_trip')
    .select('id')
    .returns<{ id: number }[]>();

  if (closeError) {
    // 23P01 — занятый интервал машины или водителя наложился на другую бронь.
    if (closeError.code === '23P01') {
      const conflicts = await lateReturnConflicts(
        { id: trip.id, carId: trip.car_id, driverId: trip.driver_id, startsAt: trip.starts_at },
        new Date(now),
      );

      return { ok: false, reason: lateReturnReason(conflicts) };
    }
    console.error(`Поездка #${tripId}: не удалось закрыть`, closeError);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  if ((closed ?? []).length === 0) {
    return { ok: false, reason: 'Поездку только что закрыл кто-то другой. Обновите экран.' };
  }

  if (trip.car_id) {
    const { error: carError } = await db
      .from('cars')
      .update({ odometer_km: trip.odometer_end_km, updated_at: now })
      .eq('id', trip.car_id);

    if (carError) {
      // Поездка закрыта, но машина осталась с прежним показанием: следующая
      // поездка начнётся не с того значения. Это надо видеть в журнале.
      console.error(`Поездка #${tripId}: одометр машины не обновлён`, carError);
    }
  }

  // Насколько опоздали со сдачей. В журнале это отдельной припиской: из
  // одного времени закрытия не видно, что машину держали лишние двое суток,
  // а искать плановое время в карточке через месяц уже некому.
  const lateByMinutes = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(trip.ends_at).getTime()) / 60_000),
  );

  const { error: eventError } = await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'closed',
    payload: {
      odometer_end_km: trip.odometer_end_km,
      planned_return_at: trip.ends_at,
      late_by_minutes: lateByMinutes,
    },
    actor_employee: employeeId,
  });

  if (eventError) {
    console.error(`Поездка #${tripId}: событие о закрытии не записано`, eventError);
  }

  await notifyTripClosed(tripId);
  // Водителю — Т6, если поездка была с водителем.
  await notifyDriverTripClosed(tripId);

  return { ok: true };
}
