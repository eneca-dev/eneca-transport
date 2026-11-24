'use server';

import { AccessError, requireEmployee } from '@/lib/auth/currentEmployee';

import { countAttention } from './queries';

import type { ActionResult } from '@/lib/types';
import type { NavCounts } from './queries';

/** Числа для красных точек у разделов. Роль не нужна: считается по своим правам. */
export async function loadNavCounts(token: string): Promise<ActionResult<NavCounts>> {
  try {
    const employee = await requireEmployee(token);
    return { success: true, data: await countAttention(employee) };
  } catch (error) {
    if (error instanceof AccessError) {
      return { success: false, error: error.message };
    }
    console.error('Не удалось посчитать дела для разделов', error);
    return { success: false, error: 'Не удалось посчитать дела.' };
  }
}
