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

/** Короткая запись сотрудника для выбора участников в Э2. */
export interface EmployeeOption {
  id: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
}

interface OptionRow {
  id: string;
  display_name: string;
  department: string | null;
  job_title: string | null;
}

/**
 * Поиск сотрудников по имени для выбора участников.
 *
 * Список целиком не отдаётся: в справочнике больше девятисот человек. Поиск
 * идёт по подстроке без учёта регистра, результат ограничен — выбирают из
 * нескольких совпадений, а не листают справочник.
 */
export async function searchEmployees(query: string, limit = 10): Promise<EmployeeOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  // Процент и подчёркивание в ilike — подстановочные знаки, их надо обезвредить,
  // иначе поиск по «%» вернёт весь справочник.
  const pattern = `%${trimmed.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;

  const { data, error } = await getDb()
    .from('employees')
    .select('id, display_name, department, job_title')
    .eq('is_active', true)
    .ilike('display_name', pattern)
    .order('display_name')
    .limit(limit)
    .returns<OptionRow[]>();

  if (error) {
    throw new Error(`Не удалось найти сотрудников: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    department: row.department,
    jobTitle: row.job_title,
  }));
}

/** Сотрудники по списку идентификаторов — для показа уже выбранных участников. */
export async function listEmployeesByIds(ids: string[]): Promise<EmployeeOption[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await getDb()
    .from('employees')
    .select('id, display_name, department, job_title')
    .in('id', ids)
    .order('display_name')
    .returns<OptionRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать сотрудников: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    department: row.department,
    jobTitle: row.job_title,
  }));
}

/** Сотрудник-получатель уведомлений: минимум, нужный для отправки. */
export interface RoleRecipient {
  id: string;
  entraOid: string;
  displayName: string;
}

interface RoleRow {
  employees: {
    id: string;
    entra_oid: string;
    display_name: string;
    is_active: boolean;
  } | null;
}

/**
 * Активные сотрудники с указанной ролью — кому уходят ролевые уведомления.
 *
 * Адресат по роли, а не по имени: в требованиях К14 адресована Дарье, а К3 —
 * «финотделу», но людей в роли может быть несколько, и уволенного спрашивать
 * бессмысленно.
 */
export async function listEmployeesByRole(role: AppRole): Promise<RoleRecipient[]> {
  const { data, error } = await getDb()
    .from('employee_roles')
    .select('employees!employee_roles_employee_id_fkey(id, entra_oid, display_name, is_active)')
    .eq('role', role)
    .returns<RoleRow[]>();

  if (error) {
    throw new Error(`Не удалось найти сотрудников с ролью ${role}: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => row.employees)
    .filter((person): person is NonNullable<typeof person> => person !== null && person.is_active)
    .map((person) => ({
      id: person.id,
      entraOid: person.entra_oid,
      displayName: person.display_name,
    }));
}
