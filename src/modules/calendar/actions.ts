'use server';

import { z } from 'zod';

import { AccessError, requireRole } from '@/lib/auth/currentEmployee';

import { loadCalendar } from './queries';

import type { ActionResult } from '@/lib/types';
import type { CalendarData } from './queries';

/** Календарь занятости (Э6). Только АХО. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const rangeSchema = z
  .object({
    since: z.string().regex(DATE, 'Укажите начало периода'),
    until: z.string().regex(DATE, 'Укажите конец периода'),
  })
  .refine((value) => value.until >= value.since, {
    message: 'Конец периода раньше начала',
    path: ['until'],
  });

export type CalendarRangeInput = z.infer<typeof rangeSchema>;

export async function loadCalendarRange(
  token: string,
  input: CalendarRangeInput,
): Promise<ActionResult<CalendarData>> {
  try {
    await requireRole(token, 'aho');

    const parsed = rangeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    return {
      success: true,
      data: await loadCalendar(parsed.data.since, parsed.data.until),
    };
  } catch (error) {
    if (error instanceof AccessError) {
      return { success: false, error: error.message };
    }
    console.error('Не удалось загрузить календарь', error);
    return { success: false, error: 'Не удалось загрузить календарь.' };
  }
}
