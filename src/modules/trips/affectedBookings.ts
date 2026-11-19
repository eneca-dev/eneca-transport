import 'server-only';

import { getDb } from '@/config/supabase';
import { formatDay } from '@/lib/datetime';

import { notifyBookingAffected } from './notifyChange';

/**
 * Брони, которые задел ремонт машины или недоступность водителя.
 *
 * Бронь не снимается и не переносится: по требованиям она сохраняется, а
 * решение принимает человек. Система только предупреждает — К13 автору и АХО.
 *
 * Берутся только будущие и ещё не выехавшие поездки. Прошедшие и те, по которым
 * ключи уже выданы, трогать бессмысленно: машина уже в пути.
 */

interface TripIdRow {
  id: number;
}

/** Машину отправили в ремонт с указанной даты. */
export async function warnAboutRepair(carId: string, since: string): Promise<number> {
  const db = getDb();

  const { data, error } = await db
    .from('trips')
    .select('id')
    .eq('car_id', carId)
    .in('status', ['booked', 'docs_ready'])
    .is('keys_issued_at', null)
    .gte('ends_at', new Date(`${since}T00:00:00+03:00`).toISOString())
    .returns<TripIdRow[]>();

  if (error) {
    console.error(`Машина ${carId}: не удалось найти затронутые брони`, error);
    return 0;
  }

  const trips = data ?? [];

  for (const trip of trips) {
    try {
      await notifyBookingAffected(
        trip.id,
        `машина в ремонте с ${formatDay(new Date(`${since}T12:00:00+03:00`))}`,
        `repair:${since}`,
      );
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: К13 о ремонте не ушла`, notifyError);
    }
  }

  return trips.length;
}

const REASON_LABEL: Record<string, string> = {
  sick: 'болезнь',
  vacation: 'отпуск',
  other: 'недоступен',
};

/**
 * Водитель недоступен в указанные даты.
 *
 * По требованиям назначение на эти поездки снимается, брони машин сохраняются,
 * а авторы и АХО получают К13. Снятие делается здесь же: иначе поездка осталась
 * бы с водителем, который точно не поедет.
 */
export async function warnAboutDriverAway(
  driverId: string,
  since: string,
  until: string,
  reason: string,
): Promise<number> {
  const db = getDb();

  const from = new Date(`${since}T00:00:00+03:00`).toISOString();
  // Период включает последний день целиком, поэтому до начала следующих суток.
  const to = new Date(
    new Date(`${until}T00:00:00+03:00`).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db
    .from('trips')
    .select('id')
    .eq('driver_id', driverId)
    .in('status', ['booked', 'docs_ready'])
    .is('keys_issued_at', null)
    .lt('starts_at', to)
    .gte('ends_at', from)
    .returns<TripIdRow[]>();

  if (error) {
    console.error(`Водитель ${driverId}: не удалось найти затронутые брони`, error);
    return 0;
  }

  const trips = data ?? [];
  const label = REASON_LABEL[reason] ?? 'недоступен';

  for (const trip of trips) {
    // Сначала уведомляем, пока водитель ещё виден в карточке: иначе в К13
    // будет «без водителя», и непонятно, о кого речь.
    try {
      await notifyBookingAffected(
        trip.id,
        `водитель недоступен (${label}) с ${formatDay(new Date(`${since}T12:00:00+03:00`))} по ${formatDay(new Date(`${until}T12:00:00+03:00`))}`,
        `away:${since}:${until}`,
      );
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: К13 о недоступности не ушла`, notifyError);
    }

    const { error: dropError } = await db
      .from('trips')
      .update({
        driver_id: null,
        driver_confirmation: 'pending',
        driver_assigned_at: null,
        docs_recheck_required: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trip.id);

    if (dropError) {
      console.error(`Поездка #${trip.id}: не удалось снять водителя`, dropError);
      continue;
    }

    await db.from('trip_events').insert({
      trip_id: trip.id,
      kind: 'driver_unassigned',
      payload: { reason: label },
    });
  }

  return trips.length;
}
