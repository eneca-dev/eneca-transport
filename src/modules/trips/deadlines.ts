import 'server-only';

import { DRIVER_CONFIRMATION_MINUTES } from '@/config/app';
import { getDb } from '@/config/supabase';

import { notifyAuthorNoDriver, notifyDriverTimeout } from './notifyDriver';

/**
 * Сроки, за которыми следит планировщик.
 *
 * Здесь только то, где события нет, а наступает срок: водитель молчит 15 минут,
 * подошло время выезда без подтверждённого водителя, просрочен возврат. Всё,
 * что вызвано действием человека, отправляется сразу в Server Action и сюда не
 * попадает.
 *
 * Каждая проверка идемпотентна: она сначала меняет состояние, а потом
 * отправляет. Повторный запуск не найдёт ту же поездку, а если найдёт —
 * `dedupe_key` в `notifications` не даст отправить второй раз. Поэтому
 * пропущенный или сдвоенный запуск безвреден.
 */

export interface TickResult {
  /** Назначений, у которых вышли 15 минут. */
  driverTimeouts: number;
  /** Поездок, где к выезду нет подтверждённого водителя. */
  authorsAsked: number;
}

interface TripIdRow {
  id: number;
}

/**
 * Водитель не ответил за отведённое время.
 *
 * Отсчёт идёт от `driver_assigned_at` — момента отправки Т1, как в требованиях,
 * а не от создания заявки: при замене водителя отсчёт начинается заново.
 */
async function expireDriverConfirmations(): Promise<number> {
  const db = getDb();
  const deadline = new Date(Date.now() - DRIVER_CONFIRMATION_MINUTES * 60_000).toISOString();

  // Статус меняется тем же запросом, которым ищется: между выборкой и
  // обновлением водитель мог успеть нажать «Подтверждаю», и перезаписывать его
  // ответ нельзя.
  const { data, error } = await db
    .from('trips')
    .update({ driver_confirmation: 'timeout', updated_at: new Date().toISOString() })
    .eq('driver_confirmation', 'pending')
    .lte('driver_assigned_at', deadline)
    .in('status', ['booked', 'docs_ready', 'in_trip'])
    .select('id')
    .returns<TripIdRow[]>();

  if (error) {
    throw new Error(`Не удалось отметить неподтверждённые назначения: ${error.message}`);
  }

  const expired = data ?? [];

  for (const trip of expired) {
    const { error: eventError } = await db.from('trip_events').insert({
      trip_id: trip.id,
      kind: 'driver_timeout',
      payload: { minutes: DRIVER_CONFIRMATION_MINUTES },
    });

    if (eventError) {
      console.error(`Поездка #${trip.id}: событие о таймауте не записано`, eventError);
    }

    try {
      await notifyDriverTimeout(trip.id);
    } catch (notifyError) {
      // Статус уже переведён, и это главное: АХО увидит его в карточке даже
      // без сообщения. Повторять отправку будет нечем до И6, поэтому пишем
      // в журнал сервера.
      console.error(`Поездка #${trip.id}: уведомления о таймауте не ушли`, notifyError);
    }
  }

  return expired.length;
}

/**
 * Подошло время выезда, а подтверждённого водителя нет.
 *
 * Статус поездки не меняется: по требованиям бронь сохраняется, пока автор не
 * выберет — ехать самому или отменить. Значит повторный проход найдёт ту же
 * поездку, и от повторной отправки защищает только занятый ключ `K16:trip:N`.
 * Поэтому ключ занимается до отправки, а не после.
 */
async function askAuthorsWithoutDriver(): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('trips')
    .select('id')
    .eq('needs_driver', true)
    .neq('driver_confirmation', 'confirmed')
    .lte('starts_at', now)
    .in('status', ['booked', 'docs_ready'])
    .returns<TripIdRow[]>();

  if (error) {
    throw new Error(`Не удалось найти поездки без водителя: ${error.message}`);
  }

  const trips = data ?? [];

  for (const trip of trips) {
    try {
      await notifyAuthorNoDriver(trip.id);
    } catch (notifyError) {
      console.error(`Поездка #${trip.id}: К16 не ушла`, notifyError);
    }
  }

  return trips.length;
}

/** Один проход планировщика. */
export async function runDeadlines(): Promise<TickResult> {
  // Сначала сроки подтверждения: поездка, у которой только что вышли 15 минут,
  // должна успеть получить статус до проверки «нет подтверждённого водителя».
  const driverTimeouts = await expireDriverConfirmations();
  const authorsAsked = await askAuthorsWithoutDriver();

  return { driverTimeouts, authorsAsked };
}
