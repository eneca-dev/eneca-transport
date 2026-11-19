'use server';

import { z } from 'zod';

import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { listHistory, listHistoryFilters } from './queries';

import type { ActionResult } from '@/lib/types';
import type { FilterOption, HistoryResult } from './queries';

/** История поездок (Э7). Только АХО. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const filtersSchema = z
  .object({
    since: z.string().regex(DATE, 'Укажите начало периода'),
    until: z.string().regex(DATE, 'Укажите конец периода'),
    carId: z.string().uuid().nullable(),
    employeeId: z.string().uuid().nullable(),
  })
  .refine((value) => value.until >= value.since, {
    message: 'Конец периода раньше начала',
    path: ['until'],
  });

export type HistoryFiltersInput = z.infer<typeof filtersSchema>;

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadHistory(
  token: string,
  input: HistoryFiltersInput,
): Promise<ActionResult<HistoryResult>> {
  try {
    await requireRole(token, 'aho');

    const parsed = filtersSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    return {
      success: true,
      data: await listHistory({
        since: parsed.data.since,
        until: parsed.data.until,
        carId: parsed.data.carId ?? undefined,
        employeeId: parsed.data.employeeId ?? undefined,
      }),
    };
  } catch (error) {
    return failure(error, 'Не удалось загрузить историю.');
  }
}

export async function loadHistoryFilters(
  token: string,
): Promise<ActionResult<{ cars: FilterOption[]; employees: FilterOption[] }>> {
  try {
    await requireRole(token, 'aho');
    return { success: true, data: await listHistoryFilters() };
  } catch (error) {
    return failure(error, 'Не удалось загрузить фильтры.');
  }
}
