'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Car, Route } from 'lucide-react';

import { useTeamsAuth } from '@/components/TeamsAuth';

import type { ReactNode } from 'react';
import type { AppRole } from '@/modules/employees/queries';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Car;
  /** Пусто — виден всем. Иначе нужна одна из ролей. */
  roles?: AppRole[];
}

// Разделы добавляются по мере готовности экранов: мёртвых ссылок в меню нет.
const NAV: NavItem[] = [
  { href: '/', label: 'Мои поездки', icon: Route },
  { href: '/cars', label: 'Машины', icon: Car, roles: ['aho'] },
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { employee } = useTeamsAuth();
  const pathname = usePathname();

  const items = NAV.filter(
    (item) => !item.roles || item.roles.some((role) => employee.roles.includes(role)),
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2">
          <nav className="flex gap-1">
            {items.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-indigo-50 font-medium text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
          <span className="truncate text-sm text-gray-500" title={employee.upn}>
            {employee.displayName}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
