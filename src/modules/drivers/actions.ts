'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { warnAboutDriverAway } from '@/modules/trips/affectedBookings';

import { listDrivers } from './queries';
import { issueCode } from './telegram';

import type { ActionResult } from '@/lib/types';
import type { Driver, DriverLinkCode } from './queries';

/**
 * Справочник водителей (Э9). Ведёт только АХО.
 *
 * Периоды недоступности вносит тоже АХО: водитель сообщает о болезни Дарье, а
 * не отмечает её сам в боте — так записано в требованиях.
 */

const driverSchema = z.object({
  fullName: z.string().trim().min(3, 'Укажите фамилию и имя').max(120, 'Слишком длинное имя'),
  // Телефон в свободной форме: его набирают руками, а не звонят из приложения.
  phone: z.string().trim().max(30, 'Слишком длинный номер'),
  comment: z.string().trim().max(500, 'Комментарий слишком длинный').optional(),
});

export type DriverInput = z.infer<typeof driverSchema>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const unavailabilitySchema = z
  .object({
    since: z.string().regex(DATE, 'Укажите дату начала'),
    until: z.string().regex(DATE, 'Укажите дату окончания'),
    reason: z.enum(['sick', 'vacation', 'other'], { error: 'Выберите причину' }),
    note: z.string().trim().max(200, 'Слишком длинное примечание'),
  })
  // Базу это тоже не пропустит, но её сообщение человеку не покажешь.
  .refine((value) => value.until >= value.since, {
    message: 'Дата окончания раньше начала',
    path: ['until'],
  });

export type UnavailabilityInput = z.infer<typeof unavailabilitySchema>;

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadDrivers(token: string): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось загрузить справочник водителей.');
  }
}

export async function createDriver(
  token: string,
  input: DriverInput,
): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');

    const parsed = driverSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb()
      .from('drivers')
      .insert({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone || null,
      comment: parsed.data.comment || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/drivers');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось добавить водителя.');
  }
}

export async function updateDriver(
  token: string,
  driverId: string,
  input: DriverInput,
): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');

    const parsed = driverSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb()
      .from('drivers')
      .update({
        full_name: parsed.data.fullName,
        phone: parsed.data.phone || null,
        comment: parsed.data.comment || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', driverId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/drivers');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось сохранить водителя.');
  }
}

/**
 * Удалить водителя. База откажет, если на него уже ссылаются поездки или
 * журнал — история не должна рваться. Поэтому удаление остаётся только для
 * ошибочно созданных записей.
 */
export async function deleteDriver(
  token: string,
  driverId: string,
): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');

    const { error } = await getDb().from('drivers').delete().eq('id', driverId);

    if (error) {
      // 23503 — внешний ключ: у водителя есть поездки.
      const message =
        error.code === '23503'
          ? 'У водителя есть поездки, удалить его нельзя.'
          : error.message;
      return { success: false, error: message };
    }

    revalidatePath('/drivers');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось удалить водителя.');
  }
}
interface CodeResult {
  code: DriverLinkCode;
  drivers: Driver[];
}

/** Выдать код привязки Telegram. Код диктуется водителю голосом. */
export async function issueLinkCode(
  token: string,
  driverId: string,
): Promise<ActionResult<CodeResult>> {
  try {
    const employee = await requireRole(token, 'aho');
    const issued = await issueCode(driverId, employee.id);

    revalidatePath('/drivers');
    return {
      success: true,
      data: {
        code: { code: issued.code, expiresAt: issued.expiresAt },
        drivers: await listDrivers(),
      },
    };
  } catch (error) {
    return failure(error, 'Не удалось выдать код.');
  }
}

export async function addUnavailability(
  token: string,
  driverId: string,
  input: UnavailabilityInput,
): Promise<ActionResult<Driver[]>> {
  try {
    const employee = await requireRole(token, 'aho');

    const parsed = unavailabilitySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb().from('driver_unavailability').insert({
      driver_id: driverId,
      since: parsed.data.since,
      until: parsed.data.until,
      reason: parsed.data.reason,
      note: parsed.data.note || null,
      created_by: employee.id,
    });

    if (error) {
      // 23P01 — ограничение EXCLUDE: периоды одного водителя не пересекаются.
      const message =
        error.code === '23P01'
          ? 'На эти даты у водителя уже отмечен период. Исправьте существующий.'
          : error.message;
      return { success: false, error: message };
    }

    // Поездки на эти даты теряют водителя: он точно не поедет. Брони машин
    // сохраняются, авторы и АХО получают К13.
    await warnAboutDriverAway(driverId, parsed.data.since, parsed.data.until, parsed.data.reason);

    revalidatePath('/drivers');
    revalidatePath('/');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось отметить период.');
  }
}

/** Правка периода: чаще всего водитель вернулся раньше и период сокращают. */
export async function updateUnavailability(
  token: string,
  periodId: string,
  input: UnavailabilityInput,
): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');

    const parsed = unavailabilitySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const { error } = await getDb()
      .from('driver_unavailability')
      .update({
        since: parsed.data.since,
        until: parsed.data.until,
        reason: parsed.data.reason,
        note: parsed.data.note || null,
      })
      .eq('id', periodId);

    if (error) {
      const message =
        error.code === '23P01'
          ? 'Новые даты пересекаются с другим периодом этого водителя.'
          : error.message;
      return { success: false, error: message };
    }

    revalidatePath('/drivers');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось изменить период.');
  }
}

export async function deleteUnavailability(
  token: string,
  periodId: string,
): Promise<ActionResult<Driver[]>> {
  try {
    await requireRole(token, 'aho');

    const { error } = await getDb().from('driver_unavailability').delete().eq('id', periodId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/drivers');
    return { success: true, data: await listDrivers() };
  } catch (error) {
    return failure(error, 'Не удалось удалить период.');
  }
}
