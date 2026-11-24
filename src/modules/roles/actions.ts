'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireRole } from '@/lib/auth/currentEmployee';
import { searchEmployees } from '@/modules/employees/queries';

import { countActiveHolders, listRoleHolders } from './queries';

import type { ActionResult } from '@/lib/types';
import type { EmployeeOption } from '@/modules/employees/queries';
import type { RolesBoard } from './queries';

/**
 * Назначение ролей. Работает только АХО — она же раздаёт доступ остальным.
 */

const roleSchema = z.enum(['aho', 'reception', 'finance']);
const employeeSchema = z.string().uuid('Непонятный сотрудник');

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadRoles(token: string): Promise<ActionResult<RolesBoard>> {
  try {
    await requireRole(token, 'aho');
    return { success: true, data: await listRoleHolders() };
  } catch (error) {
    return failure(error, 'Не удалось прочитать роли.');
  }
}

/** Поиск по справочнику, чтобы выдать роль. */
export async function searchRoleCandidates(
  token: string,
  query: string,
): Promise<ActionResult<EmployeeOption[]>> {
  try {
    await requireRole(token, 'aho');
    return { success: true, data: await searchEmployees(query) };
  } catch (error) {
    return failure(error, 'Не удалось найти сотрудников.');
  }
}

export async function grantRole(
  token: string,
  employeeId: string,
  role: string,
): Promise<ActionResult<RolesBoard>> {
  try {
    const employee = await requireRole(token, 'aho');

    const parsedRole = roleSchema.safeParse(role);
    const parsedEmployee = employeeSchema.safeParse(employeeId);

    if (!parsedRole.success || !parsedEmployee.success) {
      return { success: false, error: 'Непонятный сотрудник или роль.' };
    }

    // Повторная выдача не ошибка: кто-то мог нажать дважды. Запись одна —
    // ключ таблицы это и так обеспечивает, но без `upsert` вернулась бы
    // ошибка нарушения ключа вместо спокойного ответа.
    const { error } = await getDb().from('employee_roles').upsert(
      {
        employee_id: parsedEmployee.data,
        role: parsedRole.data,
        granted_by: employee.id,
        granted_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,role', ignoreDuplicates: true },
    );

    if (error) {
      console.error('Не удалось выдать роль', error);
      return { success: false, error: 'Не получилось сохранить. Попробуйте ещё раз.' };
    }

    revalidatePath('/roles');
    revalidatePath('/');

    return { success: true, data: await listRoleHolders() };
  } catch (error) {
    return failure(error, 'Не удалось выдать роль.');
  }
}

export async function revokeRole(
  token: string,
  employeeId: string,
  role: string,
): Promise<ActionResult<RolesBoard>> {
  try {
    await requireRole(token, 'aho');

    const parsedRole = roleSchema.safeParse(role);
    const parsedEmployee = employeeSchema.safeParse(employeeId);

    if (!parsedRole.success || !parsedEmployee.success) {
      return { success: false, error: 'Непонятный сотрудник или роль.' };
    }

    /**
     * Единственная защита этого экрана: последнюю роль АХО снять нельзя.
     *
     * Без неё в приложение не войдёт никто — ни справочники, ни календарь, ни
     * сами роли. Восстанавливать пришлось бы скриптом с чужой машины, а права
     * на это есть не у всех.
     */
    if (parsedRole.data === 'aho' && (await countActiveHolders('aho')) <= 1) {
      return {
        success: false,
        error:
          'Это последняя роль АХО. Снять её нельзя: без неё никто не сможет вести ' +
          'справочники и выдавать роли. Сначала выдайте роль другому сотруднику.',
      };
    }

    const { error } = await getDb()
      .from('employee_roles')
      .delete()
      .eq('employee_id', parsedEmployee.data)
      .eq('role', parsedRole.data);

    if (error) {
      console.error('Не удалось снять роль', error);
      return { success: false, error: 'Не получилось сохранить. Попробуйте ещё раз.' };
    }

    revalidatePath('/roles');
    revalidatePath('/');

    return { success: true, data: await listRoleHolders() };
  } catch (error) {
    return failure(error, 'Не удалось снять роль.');
  }
}
