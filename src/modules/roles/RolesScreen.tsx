'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { X } from 'lucide-react';

import { CARD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatDay } from '@/lib/datetime';

import { AddPerson } from './AddPerson';
import { grantRole, loadRoles, revokeRole } from './actions';

import type { AppRole } from '@/modules/employees/queries';
import type { RolesBoard } from './queries';

/**
 * Вкладка «Роли»: кто видит рецепцию, документы и разделы АХО.
 *
 * Роли назначает АХО, а не ИТ через Entra: иначе каждое назначение — заявка.
 * Поэтому экран нужен ей самой, и он же единственное место, где видно, у кого
 * доступ есть. Снять последнюю роль АХО нельзя — это проверяет сервер.
 */

interface RoleInfo {
  role: AppRole;
  title: string;
  what: string;
}

const ROLES: RoleInfo[] = [
  {
    role: 'aho',
    title: 'АХО',
    what: 'справочники машин и водителей, календарь, история, назначение водителей и роли',
  },
  { role: 'reception', title: 'Рецепция', what: 'выдача и приём ключей' },
  { role: 'finance', title: 'Финотдел', what: 'подготовка документов и отметка готовности' },
];

export function RolesScreen() {
  const { employee, getToken } = useTeamsAuth();

  const [board, setBoard] = useState<RolesBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (action: (token: string) => Promise<Awaited<ReturnType<typeof loadRoles>>>) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setBoard(result.data);
            setError(null);
          } else {
            setError(result.error);
          }
        } catch {
          setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
        }
      });
    },
    [getToken],
  );

  useEffect(() => {
    run((token) => loadRoles(token));
  }, [run]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Роли</h1>
      <p className="mb-4 text-sm text-fg-soft">
        Роль открывает разделы приложения и определяет, кому приходят рабочие сообщения бота.
        Сотруднику без роли доступны только свои поездки.
      </p>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {board === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {board &&
        ROLES.map(({ role, title, what }) => {
          const holders = board[role];
          const ids = holders.map((person) => person.employeeId);
          // Последнюю роль АХО снять нельзя: проверку держит сервер, но кнопку
          // лучше погасить сразу — иначе человек жмёт и получает отказ.
          const lastAho = role === 'aho' && holders.filter((person) => person.isActive).length <= 1;

          return (
            <section key={role} className={`mt-4 ${CARD} p-4`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-sm text-fg-soft">
                  {holders.length === 0 ? 'никого' : `${holders.length}`}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-fg-soft">{what}</p>

              {holders.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-line-strong p-3 text-center text-sm text-fg-soft">
                  {role === 'finance'
                    ? 'Роль никому не выдана — очередь документов никто не видит и К3 не получает.'
                    : 'Роль никому не выдана.'}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {holders.map((person) => (
                    <li
                      key={person.employeeId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          {person.displayName}
                          {person.employeeId === employee.id && (
                            <span className="text-fg-soft"> — это вы</span>
                          )}
                          {!person.isActive && (
                            <span className="text-bad-fg"> — учётная запись отключена</span>
                          )}
                        </p>
                        <p className="text-xs text-fg-soft">
                          {[person.jobTitle, person.department].filter(Boolean).join(' · ') ||
                            'подразделение неизвестно'}
                          {' · выдана '}
                          {formatDay(new Date(person.grantedAt))}
                          {person.grantedByName ? `, ${person.grantedByName}` : ''}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          run((token) => revokeRole(token, person.employeeId, role))
                        }
                        disabled={pending || lastAho}
                        className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg-soft transition-colors hover:text-fg disabled:opacity-50"
                        title={
                          lastAho
                            ? 'Последнюю роль АХО снять нельзя: без неё никто не сможет выдавать роли'
                            : undefined
                        }
                      >
                        <X className="size-3.5" aria-hidden />
                        снять
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3">
                <AddPerson
                  exclude={ids}
                  disabled={pending}
                  onPick={(employeeId) => run((token) => grantRole(token, employeeId, role))}
                />
              </div>
            </section>
          );
        })}

      {board && (
        <p className="mt-6 text-xs text-fg-soft">
          Сообщения бота адресованы роли, а не человеку: карточку о новой заявке получат все, у
          кого роль финотдела, о замене водителя — все, у кого роль АХО. Отключённой учётной записи
          сообщения не уходят, но роль у неё лучше снять.
        </p>
      )}
    </div>
  );
}
