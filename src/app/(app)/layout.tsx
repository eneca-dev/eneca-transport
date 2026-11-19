import { AppShell } from '@/components/AppShell';
import { TeamsAuthProvider } from '@/components/TeamsAuth';
import { TeamsDeepLink } from '@/components/TeamsDeepLink';

import type { ReactNode } from 'react';

/**
 * Каркас той части приложения, которая требует входа в Teams.
 *
 * Группа `(app)` не меняет адреса: «Мои поездки» по-прежнему на `/`. Она нужна
 * только чтобы отделить страницы с входом от публичных `/privacy` и `/terms`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TeamsDeepLink />
      <TeamsAuthProvider>
        <AppShell>{children}</AppShell>
      </TeamsAuthProvider>
    </>
  );
}
