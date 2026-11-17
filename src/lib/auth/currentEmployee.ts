import 'server-only';

import { verifyTeamsToken } from '@/lib/auth/verifyTeamsToken';
import { findEmployeeByOid } from '@/modules/employees/queries';

import type { AppRole, Employee } from '@/modules/employees/queries';

/**
 * Кто сейчас работает во вкладке.
 *
 * Вкладка открывается в iframe на teams.microsoft.com, поэтому её куки —
 * сторонние, а Safari и мобильный клиент Teams их не отдают. Сессию в куке
 * держать нельзя: вкладка получает токен у Teams и передаёт его первым
 * аргументом в каждый Server Action, а он проверяется здесь.
 *
 * Проверка токена — это подпись Entra ID, её нельзя подделать, поэтому
 * доверять аргументу безопасно. Роль читается из базы, а не из токена.
 */

export class AccessError extends Error {}

/** Сотрудник по токену вкладки. Бросает AccessError, если доступа нет. */
export async function requireEmployee(token: string): Promise<Employee> {
  let entraOid: string;
  try {
    ({ entraOid } = await verifyTeamsToken(token));
  } catch {
    throw new AccessError('Вход не подтверждён. Обновите вкладку.');
  }

  const employee = await findEmployeeByOid(entraOid);

  if (!employee) {
    // Сотрудник есть в Entra, но справочник его ещё не видел: синхронизация
    // идёт раз в сутки, а человек мог выйти на работу сегодня.
    throw new AccessError(
      'Вас ещё нет в справочнике сотрудников. Он обновляется раз в сутки — обратитесь в АХО.',
    );
  }
  if (!employee.isActive) {
    throw new AccessError('Учётная запись отключена.');
  }

  return employee;
}

/** То же, но с требованием роли. */
export async function requireRole(token: string, ...roles: AppRole[]): Promise<Employee> {
  const employee = await requireEmployee(token);

  if (!roles.some((role) => employee.roles.includes(role))) {
    throw new AccessError('Этот раздел доступен только сотрудникам АХО.');
  }
  return employee;
}
