'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { issueTooSoon, issueTooSoonReason } from '@/modules/trips/bookingConflicts';
import { acceptKeys } from '@/modules/trips/returnService';

import { notifyKeysIssued } from './notify';
import { listReceptionDay } from './queries';

import type { ActionResult } from '@/lib/types';
import type { ReceptionDay } from './queries';

/**
 * Выдача и приём ключей (Э4). Работает рецепция, видит и АХО.
 */

const tripIdSchema = z.number().int().positive('Непонятный номер заявки');

/** День, который рецепция открыла: «2026-11-24». Не задан — сегодня. */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Непонятная дата')
  .optional();

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadReceptionDay(
  token: string,
  day?: string,
): Promise<ActionResult<ReceptionDay>> {
  try {
    await requireRole(token, 'reception', 'aho');

    const parsed = daySchema.safeParse(day);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    return { success: true, data: await listReceptionDay(parsed.data) };
  } catch (error) {
    return failure(error, 'Не удалось загрузить экран рецепции.');
  }
}

interface TripForIssue {
  id: number;
  status: string;
  car_id: string | null;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  keys_issued_at: string | null;
}

/**
 * Выдать ключи.
 *
 * Здесь закрепляется начальное показание одометра: берётся текущее значение
 * машины и сохраняется снимком в поездке. Дальше машина может быть исправлена
 * кем угодно — пробег этой поездки считается от снимка, а не от живого
 * значения.
 */
export async function issueKeys(
  token: string,
  tripId: number,
): Promise<ActionResult<ReceptionDay>> {
  try {
    const employee = await requireRole(token, 'reception', 'aho');

    const parsed = tripIdSchema.safeParse(tripId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const db = getDb();

    const { data: trip, error } = await db
      .from('trips')
      .select('id, status, car_id, docs_ready_at, docs_recheck_required, keys_issued_at')
      .eq('id', parsed.data)
      .maybeSingle<TripForIssue>();

    if (error || !trip) {
      return { success: false, error: 'Заявка не найдена.' };
    }
    if (trip.keys_issued_at !== null) {
      return { success: false, error: 'Ключи по этой заявке уже выданы.' };
    }
    if (!['booked', 'docs_ready'].includes(trip.status)) {
      return { success: false, error: 'Заявка отменена или уже закрыта.' };
    }
    if (trip.docs_ready_at === null || trip.docs_recheck_required) {
      // Рецепция выдаёт документы вместе с ключами: без готовых документов
      // выдавать нечего. Если ехать нужно срочно, отметить готовность может АХО.
      return {
        success: false,
        error: 'Документы не готовы. Ключи выдаются вместе с документами.',
      };
    }
    if (!trip.car_id) {
      return { success: false, error: 'В заявке не выбрана машина.' };
    }

    // Инвариант требований: следующую выдачу машины нельзя оформить, пока не
    // закрыта предыдущая поездка.
    const { data: busy, error: busyError } = await db
      .from('trips')
      .select('id')
      .eq('car_id', trip.car_id)
      .eq('status', 'in_trip')
      .returns<{ id: number }[]>();

    if (busyError) {
      return { success: false, error: 'Не удалось проверить машину. Попробуйте ещё раз.' };
    }
    if ((busy ?? []).length > 0) {
      return {
        success: false,
        error: `Машина ещё в поездке №${busy![0].id}. Сначала примите её.`,
      };
    }

    // Требование: следующая бронь — не раньше чем через 10 минут после
    // фактического возврата. Проверяется здесь, а не ограничением базы:
    // закрытая поездка время больше не занимает (миграция 0004), иначе
    // просроченный возврат вообще нельзя принять.
    const tooSoon = await issueTooSoon(trip.car_id, new Date());

    if (tooSoon) {
      return { success: false, error: issueTooSoonReason(tooSoon) };
    }

    const { data: car, error: carError } = await db
      .from('cars')
      .select('odometer_km')
      .eq('id', trip.car_id)
      .maybeSingle<{ odometer_km: number }>();

    if (carError || !car) {
      return { success: false, error: 'Не удалось прочитать одометр машины.' };
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await db
      .from('trips')
      .update({
        status: 'in_trip',
        keys_issued_at: now,
        keys_issued_by: employee.id,
        // Снимок начального показания: значение при прошлом возврате.
        odometer_start_km: car.odometer_km,
        updated_at: now,
      })
      .eq('id', parsed.data)
      .is('keys_issued_at', null)
      .select('id')
      .returns<{ id: number }[]>();

    if (updateError) {
      console.error(`Поездка #${parsed.data}: не удалось выдать ключи`, updateError);
      return { success: false, error: 'Не получилось сохранить. Попробуйте ещё раз.' };
    }

    // Пусто означает, что ключи успел выдать кто-то другой между проверкой и
    // записью: условие `keys_issued_at is null` не совпало.
    if ((updated ?? []).length === 0) {
      return { success: false, error: 'Ключи только что выдал кто-то другой. Обновите экран.' };
    }

    const { error: eventError } = await db.from('trip_events').insert({
      trip_id: parsed.data,
      kind: 'keys_issued',
      payload: { odometer_start_km: car.odometer_km },
      actor_employee: employee.id,
    });

    if (eventError) {
      console.error(`Поездка #${parsed.data}: событие о выдаче не записано`, eventError);
    }

    await notifyKeysIssued(parsed.data);

    revalidatePath('/reception');
    revalidatePath('/');

    return { success: true, data: await listReceptionDay() };
  } catch (error) {
    return failure(error, 'Не удалось выдать ключи.');
  }
}

/**
 * «Принять» на рецепции: ключи сданы, поездка закрывается.
 *
 * Доступно только после корректного показания одометра — проверку держит
 * `acceptKeys`, а не экран: ту же кнопку увидит и АХО.
 */
export async function acceptTripKeys(
  token: string,
  tripId: number,
): Promise<ActionResult<ReceptionDay>> {
  try {
    const employee = await requireRole(token, 'reception', 'aho');

    const parsed = tripIdSchema.safeParse(tripId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const outcome = await acceptKeys(parsed.data, employee.id);

    if (!outcome.ok) {
      return { success: false, error: outcome.reason };
    }

    revalidatePath('/reception');
    revalidatePath('/');

    return { success: true, data: await listReceptionDay() };
  } catch (error) {
    return failure(error, 'Не удалось принять ключи.');
  }
}
