'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Car, FileText, KeyRound, Route, UserRound } from 'lucide-react';

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
  { href: '/reception', label: 'Рецепция', icon: KeyRound, roles: ['reception', 'aho'] },
  { href: '/documents', label: 'Документы', icon: FileText, roles: ['finance', 'aho'] },
  { href: '/cars', label: 'Машины', icon: Car, roles: ['aho'] },
  { href: '/drivers', label: 'Водители', icon: UserRound, roles: ['aho'] },
];

/** «Александра Бирило» → «АБ». Нужны первые буквы двух первых слов. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { employee } = useTeamsAuth();
  const pathname = usePathname();

  const items = NAV.filter(
    (item) => !item.roles || item.roles.some((role) => employee.roles.includes(role)),
  );

  // Сотруднику без ролей переключать нечего: у него один раздел, и его название
  // Teams уже показывает закладкой рядом с «Чат». Вторая такая же полоска внутри
  // вкладки только дублировала бы её, поэтому её нет совсем.
  const switchable = items.length > 1;

  return (
    <div className="flex min-h-full flex-col">
      {switchable && (
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4">
            {/* Закладки с подчёркиванием, как в самом Teams: активный раздел
                читается по жирному тексту и полосе, а не по цвету фона.
                У АХО разделов пять — на узком экране полоска прокручивается
                вбок, а не сжимает названия до нечитаемых. */}
            <nav className="-mb-px flex min-w-0 overflow-x-auto">
              {items.map(({ href, label, icon: Icon }) => {
                // Новая поездка и карточка поездки живут под /trips, но по сути
                // это раздел «Мои поездки» — закладка остаётся подсвеченной.
                const active =
                  href === '/'
                    ? pathname === '/' || pathname.startsWith('/trips')
                    : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap transition-colors ${
                      active
                        ? 'border-brand font-semibold text-brand-text'
                        : 'border-transparent text-fg-soft hover:text-fg'
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex min-w-0 items-center gap-2" title={employee.upn}>
              <span className="hidden truncate text-sm text-fg-soft sm:block">
                {employee.displayName}
              </span>
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-fg"
              >
                {initials(employee.displayName)}
              </span>
            </div>
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
