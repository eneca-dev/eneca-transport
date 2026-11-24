import 'server-only';

import { getDb } from '@/config/supabase';

import type { AppRole } from '@/modules/employees/queries';

/**
 * Кто какие роли имеет (вкладка «Роли»).
 *
 * Роли живут в своей таблице, а не в App Roles Entra: иначе каждое назначение
 * блокировалось бы заявкой в ИТ. До этого экрана их выдавал скрипт
 * `scripts/grant-role.mjs` — он остаётся для первого АХО и для восстановления
 * доступа, если роль случайно снимут со всех.
 */

export interface RoleHolder {
  employeeId: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
  /** Уволенного из справочника видно: роль у него осталась, а уведомления уже не идут. */
  isActive: boolean;
  grantedAt: string;
  grantedByName: string | null;
}

export type RolesBoard = Record<AppRole, RoleHolder[]>;

interface Row {
  role: AppRole;
  granted_at: string;
  employees: {
    id: string;
    display_name: string;
    department: string | null;
    job_title: string | null;
    is_active: boolean;
  } | null;
  granted_by_employee: { display_name: string } | null;
}

// Две ссылки на employees в одной таблице, поэтому связь указывается именем
// ограничения: иначе PostgREST не знает, какую из них подставить.
const SELECT =
  'role, granted_at, ' +
  'employees!employee_roles_employee_id_fkey(id, display_name, department, job_title, is_active), ' +
  'granted_by_employee:employees!employee_roles_granted_by_fkey(display_name)';

export async function listRoleHolders(): Promise<RolesBoard> {
  const { data, error } = await getDb()
    .from('employee_roles')
    .select(SELECT)
    .order('granted_at')
    .returns<Row[]>();

  if (error) {
    throw new Error(`Не удалось прочитать роли: ${error.message}`);
  }

  const board: RolesBoard = { aho: [], reception: [], finance: [] };

  for (const row of data ?? []) {
    if (!row.employees) {
      continue;
    }

    board[row.role].push({
      employeeId: row.employees.id,
      displayName: row.employees.display_name,
      department: row.employees.department,
      jobTitle: row.employees.job_title,
      isActive: row.employees.is_active,
      grantedAt: row.granted_at,
      grantedByName: row.granted_by_employee?.display_name ?? null,
    });
  }

  for (const role of Object.keys(board) as AppRole[]) {
    board[role].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  }

  return board;
}

/**
 * Сколько действующих сотрудников имеют роль.
 *
 * Нужно единственной защите этого экрана: последнюю роль АХО снять нельзя.
 * Уволенные не считаются — войти они всё равно не могут.
 */
export async function countActiveHolders(role: AppRole): Promise<number> {
  const { data, error } = await getDb()
    .from('employee_roles')
    .select('employees!employee_roles_employee_id_fkey(is_active)')
    .eq('role', role)
    .returns<{ employees: { is_active: boolean } | null }[]>();

  if (error) {
    throw new Error(`Не удалось посчитать роль ${role}: ${error.message}`);
  }

  return (data ?? []).filter((row) => row.employees?.is_active).length;
}
