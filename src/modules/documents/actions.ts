'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { listDocumentQueue } from './queries';
import { setDocsReady } from './service';

import type { ActionResult } from '@/lib/types';
import type { DocumentQueueItem } from './queries';

/**
 * Очередь документов (Э5). Ведёт финотдел, видит и АХО.
 *
 * АХО допущена намеренно: по требованиям она управляет бронями и должна видеть,
 * что тормозит выезд. Отмечать готовность может и она — у финотдела может не
 * оказаться никого на месте.
 */

const tripIdSchema = z.number().int().positive('Непонятный номер заявки');

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadDocumentQueue(
  token: string,
): Promise<ActionResult<DocumentQueueItem[]>> {
  try {
    await requireRole(token, 'finance', 'aho');
    return { success: true, data: await listDocumentQueue() };
  } catch (error) {
    return failure(error, 'Не удалось загрузить очередь документов.');
  }
}

/**
 * «Документы готовы».
 *
 * Снимает отметку повторной проверки и переводит заявку в статус
 * «Документы готовы». Автору сразу уходит К4 с просьбой забрать документы и
 * ключи на рецепции.
 */
export async function markDocsReady(
  token: string,
  tripId: number,
): Promise<ActionResult<DocumentQueueItem[]>> {
  try {
    const employee = await requireRole(token, 'finance', 'aho');

    const parsed = tripIdSchema.safeParse(tripId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const outcome = await setDocsReady(parsed.data, employee.id);

    if (!outcome.ok) {
      return { success: false, error: outcome.reason };
    }

    revalidatePath('/documents');
    revalidatePath('/');

    return { success: true, data: await listDocumentQueue() };
  } catch (error) {
    return failure(error, 'Не удалось отметить документы готовыми.');
  }
}
