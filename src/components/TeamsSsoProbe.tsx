'use client';

import { useEffect, useState } from 'react';
import { app, authentication } from '@microsoft/teams-js';

import type { TeamsIdentity } from '@/lib/auth/verifyTeamsToken';

type ProbeState =
  | { stage: 'loading'; message: string }
  | { stage: 'ok'; identity: TeamsIdentity }
  | { stage: 'error'; message: string };

/**
 * Временный экран проверки входа через Entra ID (неделя 1 плана этапа 1).
 * Удаляется, когда появятся настоящие экраны Э1–Э9.
 */
export function TeamsSsoProbe() {
  const [state, setState] = useState<ProbeState>({
    stage: 'loading',
    message: 'Инициализация Teams…',
  });

  useEffect(() => {
    async function run() {
      try {
        await app.initialize();
        setState({ stage: 'loading', message: 'Запрашиваю токен у Teams…' });

        const token = await authentication.getAuthToken();
        setState({ stage: 'loading', message: 'Проверяю токен на сервере…' });

        const response = await fetch('/api/auth/me', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const result = await response.json();

        if (!result.success) {
          setState({ stage: 'error', message: result.error });
          return;
        }
        setState({ stage: 'ok', identity: result.data });
      } catch (error) {
        setState({
          stage: 'error',
          message: error instanceof Error ? error.message : 'Не удалось получить токен',
        });
      }
    }
    void run();
  }, []);

  return (
    <div className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="mb-4 text-lg font-semibold">Проверка входа через Entra ID</h1>

      {state.stage === 'loading' && <p className="text-gray-500">{state.message}</p>}

      {state.stage === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-800">Вход не выполнен</p>
          <p className="mt-1 break-words text-red-700">{state.message}</p>
        </div>
      )}

      {state.stage === 'ok' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-medium text-green-800">Вход выполнен</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-green-900">
            <dt className="text-green-700">Сотрудник</dt>
            <dd>{state.identity.displayName}</dd>
            <dt className="text-green-700">Аккаунт</dt>
            <dd className="break-all">{state.identity.upn}</dd>
            <dt className="text-green-700">Entra OID</dt>
            <dd className="break-all font-mono text-xs">{state.identity.entraOid}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
