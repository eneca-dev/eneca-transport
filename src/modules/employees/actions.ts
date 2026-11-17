'use server';

import { AccessError, requireEmployee } from '@/lib/auth/currentEmployee';

import type { ActionResult } from '@/lib/types';
import type { Employee } from './queries';

/** Кто вошёл во вкладку и какие у него роли. Вызывается при открытии вкладки. */
export async function loadSession(token: string): Promise<ActionResult<Employee>> {
  try {
    return { success: true, data: await requireEmployee(token) };
  } catch (error) {
    if (error instanceof AccessError) {
      return { success: false, error: error.message };
    }
    console.error('Не удалось определить сотрудника:', error);
    return { success: false, error: 'Не удалось определить сотрудника. Попробуйте обновить вкладку.' };
  }
}
