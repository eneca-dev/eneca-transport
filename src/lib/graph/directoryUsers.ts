import 'server-only';

import { getGraphToken } from '@/lib/graph/appToken';

/**
 * Чтение каталога сотрудников из Microsoft Graph.
 *
 * Берутся только внутренние учётные записи (`userType eq 'Member'`): гости —
 * это подрядчики из чужих тенантов, в поездки их не включают. Отключённые
 * учётные записи не отбрасываются, а приходят с `accountEnabled: false`:
 * уволенный сотрудник должен остаться в базе, иначе закрытые поездки потеряют
 * автора и участников.
 *
 * Надёжного признака «человек, а не почтовый ящик» в каталоге ЭНЭКА нет:
 * проверено 16.11 — ни отдел, ни должность, ни лицензия не отделяют переговорки
 * и служебные ящики от настоящих сотрудников. Поэтому служебные записи
 * синхронизируются вместе со всеми; в подборе участников они не мешают, потому
 * что поиск идёт по имени.
 */

const SELECT = [
  'id',
  'displayName',
  'userPrincipalName',
  'mail',
  'jobTitle',
  'department',
  'accountEnabled',
].join(',');

export interface DirectoryUser {
  id: string;
  displayName: string | null;
  userPrincipalName: string | null;
  mail: string | null;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean | null;
  manager?: { id?: string } | null;
}

interface UsersPage {
  value?: DirectoryUser[];
  '@odata.nextLink'?: string;
  error?: { message?: string };
}

/** Все внутренние учётные записи каталога. Постранично, пока Graph отдаёт nextLink. */
export async function fetchDirectoryUsers(): Promise<DirectoryUser[]> {
  const token = await getGraphToken();

  const query = new URLSearchParams({
    $select: SELECT,
    $expand: 'manager($select=id)',
    $filter: "userType eq 'Member'",
    $top: '999',
  });

  let url: string | undefined = `https://graph.microsoft.com/v1.0/users?${query.toString()}`;
  const users: DirectoryUser[] = [];

  while (url) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const page = (await response.json()) as UsersPage;

    if (!response.ok) {
      throw new Error(`Graph вернул ${response.status}: ${page.error?.message ?? 'без описания'}`);
    }

    users.push(...(page.value ?? []));
    url = page['@odata.nextLink'];
  }

  return users;
}
