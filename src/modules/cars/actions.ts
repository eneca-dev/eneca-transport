'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { listCars } from './queries';
import { warnAboutRepair } from '@/modules/trips/affectedBookings';

import { decideRemark } from './remarks';

import type { ActionResult } from '@/lib/types';
import type { Car } from './queries';
import type { RemarkDecision } from './remarks';

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
      // историю одометра. Остальные отказы базы пересказывать нельзя: её текст
      // по-английски и про столбцы, а не про машину.
      if (error.code === '23505') {
        return { success: false, error: 'Машина с таким номером уже есть.' };
      }

      console.error('Машина не добавлена', error);
      return { success: false, error: 'Не удалось добавить машину. Попробуйте ещё раз.' };
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
      if (error.code === '23505') {
        return { success: false, error: 'Машина с таким номером уже есть.' };
      }

      console.error(`Машина ${carId}: правка не сохранилась`, error);
      return { success: false, error: 'Не удалось сохранить машину. Попробуйте ещё раз.' };
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
      if (error.code === '23505') {
        return { success: false, error: 'Эта машина уже числится в ремонте.' };
      }

      console.error(`Машина ${carId}: ремонт не открылся`, error);
      return { success: false, error: 'Не удалось отправить машину в ремонт. Попробуйте ещё раз.' };
    }

    // Брони на эти даты не снимаем: по требованиям решение за человеком.
    // Но автор и АХО должны узнать, что машины не будет.
    await warnAboutRepair(carId, new Date().toISOString().slice(0, 10));

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось отправить машину в ремонт.');
  }
}

/**
 * Ремонт закончен: у открытого периода проставляется дата окончания.
 *
 * Дату сначала читаем, а потом пишем, из-за ограничения базы
 * `car_repairs_check`: `until` не может быть раньше `since`. Приложение
 * открывает ремонт только с сегодняшнего дня, но в базе встречается начало
 * в будущем — так заводят ремонт скриптом или правкой в таблице. Закрыть его
 * «сегодняшним» числом нельзя, и база отвечала отказом на английском.
 * Поэтому у такого ремонта день окончания равен дню начала: период в один
 * день, а не отказ, разбираться в котором пришлось бы АХО.
 */
export async function finishRepair(token: string, carId: string): Promise<ActionResult<Car[]>> {
  try {
    await requireRole(token, 'aho');

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const { data: open, error: openError } = await db
      .from('car_repairs')
      .select('id, since')
      .eq('car_id', carId)
      .is('until', null)
      .maybeSingle<{ id: string; since: string }>();

    if (openError) {
      console.error(`Машина ${carId}: запись о ремонте не прочиталась`, openError);
      return { success: false, error: 'Не удалось прочитать запись о ремонте. Попробуйте ещё раз.' };
    }

    // Открытого ремонта нет: кнопку нажали дважды или ремонт закрыл кто-то
    // другой. Отказывать не за что — машина и так свободна.
    if (!open) {
      revalidatePath('/cars');
      return { success: true, data: await listCars() };
    }

    const { error } = await db
      .from('car_repairs')
      .update({ until: open.since > today ? open.since : today })
      .eq('id', open.id);

    if (error) {
      console.error(`Машина ${carId}: ремонт не закрылся`, error);
      return { success: false, error: 'Не удалось закрыть ремонт. Попробуйте ещё раз.' };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось закрыть ремонт.');
  }
}

/**
 * Решение по замечанию или примечанию из возврата.
 *
 * `to_repair` вдобавок открывает период ремонта с текстом замечания — чтобы
 * АХО не переписывала его руками.
 */
export async function decideCarRemark(
  token: string,
  tripId: number,
  decision: RemarkDecision,
): Promise<ActionResult<Car[]>> {
  try {
    const employee = await requireRole(token, 'aho');

    const outcome = await decideRemark(tripId, decision, employee.id);

    if (!outcome.ok) {
      return { success: false, error: outcome.reason };
    }

    revalidatePath('/cars');
    return { success: true, data: await listCars() };
  } catch (error) {
    return failure(error, 'Не удалось закрыть замечание.');
  }
}
