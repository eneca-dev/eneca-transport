'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { listCars } from './queries';

import type { ActionResult } from '@/lib/types';
import type { Car } from './queries';

/**
 * Справочник машин (Э8). Ведёт только АХО — так записано в правах участников.
 */

// Номер в свободной форме: белорусские, российские и транзитные номера
// выглядят по-разному, и АХО не должна подбирать формат под проверку.
const carSchema = z.object({
  plate: z.string().trim().min(3, 'Укажите номер').max(20, 'Слишком длинный номер'),
  model: z.string().trim().min(2, 'Укажите модель').max(60, 'Слишком длинное название'),
  odometerKm: z
    .number({ error: 'Укажите показание одометра' })
    .int('Только целое число')
    .min(0, 'Не может быть отрицательным')
    .max(10_000_000, 'Слишком большое значение'),
});

export type CarInput = z.infer<typeof carSchema>;

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadCars(token: string): Promise<ActionResult<Car[]>> {
  try {
    await requireRole(token, 'aho');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось загрузить справочник машин.');
  }
}

export async function createCar(token: string, input: CarInput): Promise<ActionResult<Car[]>> {
  try {
    await requireRole(token, 'aho');

    const parsed = carSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb().from('cars').insert({
      plate: parsed.data.plate,
      model: parsed.data.model,
      odometer_km: parsed.data.odometerKm,
    });

    if (error) {
      // Номер уникален на уровне базы: две записи на одну машину развалили бы
      // историю одометра.
      const message = error.code === '23505' ? 'Машина с таким номером уже есть.' : error.message;
      return { success: false, error: message };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось добавить машину.');
  }
}

export async function updateCar(
  token: string,
  carId: string,
  input: CarInput,
): Promise<ActionResult<Car[]>> {
  try {
    await requireRole(token, 'aho');

    const parsed = carSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb()
      .from('cars')
      .update({
        plate: parsed.data.plate,
        model: parsed.data.model,
        odometer_km: parsed.data.odometerKm,
        updated_at: new Date().toISOString(),
      })
      .eq('id', carId);

    if (error) {
      const message = error.code === '23505' ? 'Машина с таким номером уже есть.' : error.message;
      return { success: false, error: message };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось сохранить машину.');
  }
}

/** Отправить машину в ремонт: открывается период без даты окончания. */
export async function startRepair(
  token: string,
  carId: string,
  note: string,
): Promise<ActionResult<Car[]>> {
  try {
    const employee = await requireRole(token, 'aho');

    const { error } = await getDb().from('car_repairs').insert({
      car_id: carId,
      since: new Date().toISOString().slice(0, 10),
      note: note.trim() || null,
      created_by: employee.id,
    });

    if (error) {
      // Частичный уникальный индекс не даёт открыть второй ремонт на ту же машину.
      const message =
        error.code === '23505' ? 'Эта машина уже числится в ремонте.' : error.message;
      return { success: false, error: message };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось отправить машину в ремонт.');
  }
}

/** Ремонт закончен: у открытого периода проставляется дата окончания. */
export async function finishRepair(token: string, carId: string): Promise<ActionResult<Car[]>> {
  try {
    await requireRole(token, 'aho');

    const { error } = await getDb()
      .from('car_repairs')
      .update({ until: new Date().toISOString().slice(0, 10) })
      .eq('car_id', carId)
      .is('until', null);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось закрыть ремонт.');
  }
}
