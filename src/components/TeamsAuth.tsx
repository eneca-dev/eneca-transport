'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { app, authentication } from '@microsoft/teams-js';

import { loadSession } from '@/modules/employees/actions';

import type { ReactNode } from 'react';
import type { Employee } from '@/modules/employees/queries';

/**
 * Вход во вкладку.
 *
 * Токен не кэшируется и не кладётся в куку: Teams держит свой кэш, а кука в
 * iframe была бы сторонней — Safari и мобильный клиент её не отдают. Поэтому
 * `getToken()` каждый раз спрашивает Teams, а дальше токен передаётся первым
 * аргументом в Server Action.
 */

interface TeamsAuthValue {
  employee: Employee;
  getToken: () => Promise<string>;
}

const TeamsAuthContext = createContext<TeamsAuthValue | null>(null);

export function useTeamsAuth(): TeamsAuthValue {
  const value = useContext(TeamsAuthContext);
  if (!value) {
    throw new Error('useTeamsAuth вызван вне TeamsAuthProvider');
  }
  return value;
}

type State =
  | { stage: 'loading' }
  | { stage: 'ready'; employee: Employee }
  | { stage: 'error'; message: string };

interface TeamsAuthProviderProps {
  children: ReactNode;
}

export function TeamsAuthProvider({ children }: TeamsAuthProviderProps) {
  const [state, setState] = useState<State>({ stage: 'loading' });

  const getToken = useCallback(async () => {
    await app.initialize();
    return authentication.getAuthToken();
  }, []);

  useEffect(() => {
    async function run() {
      try {
        const token = await getToken();
        const result = await loadSession(token);
        setState(
          result.success
            ? { stage: 'ready', employee: result.data }
            : { stage: 'error', message: result.error },
        );
      } catch (error) {
        setState({
          stage: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Teams не выдал токен. Откройте вкладку внутри Teams.',
        });
      }
    }
    void run();
  }, [getToken]);

  if (state.stage === 'loading') {
    return <p className="p-6 text-sm text-fg-soft">Загрузка…</p>;
  }

  if (state.stage === 'error') {
    return (
      <div className="m-6 rounded-lg border border-bad-line bg-bad p-4 text-sm text-bad-fg">
        <p className="font-medium">Не удалось войти</p>
        <p className="mt-1">{state.message}</p>
      </div>
    );
  }

  return (
    <TeamsAuthContext.Provider value={{ employee: state.employee, getToken }}>
      {children}
    </TeamsAuthContext.Provider>
  );
}
