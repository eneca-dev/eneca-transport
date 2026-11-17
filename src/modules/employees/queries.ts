import 'server-only';

import { getDb } from '@/config/supabase';

/** Роли приложения. Повторяют тип `app_role` в базе. */
export type AppRole = 'aho' | 'reception' | 'finance';

export interface Employee {
  id: string;
  entraOid: string;
  upn: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
  isActive: boolean;
  roles: AppRole[];
}

interface EmployeeRow {
  id: string;
  entra_oid: string;
  upn: string;
  display_name: string;
  department: string | null;
  job_title: string | null;
  is_active: boolean;
  employee_roles: { role: AppRole }[] | null;
}

// Связь указывается явно: у employee_roles две ссылки на employees —
// кому выдана роль и кто её выдал. Без имени внешнего ключа запрос падает.
const SELECT =
  'id, entra_oid, upn, display_name, department, job_title, is_active, ' +
  'employee_roles!employee_roles_employee_id_fkey(role)';

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    entraOid: row.entra_oid,
    upn: row.upn,
    displayName: row.display_name,
    department: row.department,
    jobTitle: row.job_title,
    isActive: row.is_active,
    roles: (row.employee_roles ?? []).map((r) => r.role),
  };
}

/** Сотрудник по Entra OID — тому самому, что приходит в токене вкладки. */
export async function findEmployeeByOid(entraOid: string): Promise<Employee | null> {
  const { data, error } = await getDb()
    .from('employees')
    .select(SELECT)
    .eq('entra_oid', entraOid)
    .maybeSingle<EmployeeRow>();

  if (error) {
    throw new Error(`Не удалось прочитать сотрудника: ${error.message}`);
  }
  return data ? toEmployee(data) : null;
}
