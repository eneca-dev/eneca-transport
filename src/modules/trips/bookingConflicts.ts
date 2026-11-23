import 'server-only';

import { BOOKING_BUFFER_MINUTES } from '@/config/app';
import { getDb } from '@/config/supabase';

import type { ConflictingTrip } from './conflictText';

/**
 * Что мешает закрыть просроченную поездку.
 *
 * Машина и водитель заняты от выезда до фактического возврата, а не до
 * планового — это требование, и за ним стоят ограничения базы
 * `trips_car_no_overlap` и `trips_driver_no_overlap`. Отсюда следствие,
 * неочевидное для человека на рецепции: пока машину ждали, на неё могли
 * завести бронь, и тогда поздний возврат в эту бронь упирается.
 *
 * База в таком случае отвечает кодом `23P01` — «нарушено ограничение
 * исключения». Пересказать это человеку нельзя, поэтому мешающие заявки
 * ищутся и называются по номерам, а решение принимает он: перенести чужую
 * бронь или отменить её.
 *
 * Спрашивают об этом в двух местах: Э5 — до нажатия, чтобы кнопка «Принять»
 * не выглядела рабочей, и `returnService` — когда база всё же отказала.
 * Формулировки лежат в `conflictText`, без доступа к базе, чтобы их можно было
 * прочитать и проверить без приложения; здесь только поиск.
 */

export { conflictList, lateReturnReason } from './conflictText';
export type { ConflictingTrip } from './conflictText';

/** Поездка, которую пытаются закрыть. */
export interface OccupyingTrip {
  id: number;
  carId: string | null;
  driverId: string | null;
  startsAt: string;
}

interface Row {
  id: number;
  starts_at: string;
  ends_at: string;
  car_id: string | null;
  driver_id: string | null;
}

/**
 * Брони, на которые наложится поездка, если закрыть её возвратом в `returnedAt`.
 *
 * Условие пересечения берётся по столбцам, а не по `booking_during`: сравнивать
 * диапазоны через PostgREST нельзя. Разница только в буфере — он добавлен к
 * правой границе, как в `fn_trips_booking_during`.
 */
export async function lateReturnConflicts(
  trip: OccupyingTrip,
  returnedAt: Date,
): Promise<ConflictingTrip[]> {
  const owners: string[] = [];

  if (trip.carId) {
    owners.push(`car_id.eq.${trip.carId}`);
  }
  if (trip.driverId) {
    owners.push(`driver_id.eq.${trip.driverId}`);
  }

  if (owners.length === 0) {
    return [];
  }

  const until = new Date(returnedAt.getTime() + BOOKING_BUFFER_MINUTES * 60_000).toISOString();

  const { data, error } = await getDb()
    .from('trips')
    .select('id, starts_at, ends_at, car_id, driver_id')
    .neq('id', trip.id)
    .not('status', 'in', '(draft,cancelled)')
    .or(owners.join(','))
    .lt('starts_at', until)
    .gte('ends_at', trip.startsAt)
    .order('starts_at')
    .returns<Row[]>();

  if (error) {
    console.error(`Поездка #${trip.id}: мешающую бронь найти не удалось`, error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    kind: row.car_id !== null && row.car_id === trip.carId ? 'car' : 'driver',
  }));
}
