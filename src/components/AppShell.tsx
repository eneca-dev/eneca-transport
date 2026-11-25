'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Car,
  CircleQuestionMark,
  FileText,
  History,
  KeyRound,
  Route,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { useNavCounts } from '@/components/NavCounts';
import { useTeamsAuth } from '@/components/TeamsAuth';

import type { ReactNode } from 'react';
import type { AppRole } from '@/modules/employees/queries';
import type { CountedSection } from '@/modules/nav/queries';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Car;
  /** Пусто — виден всем. Иначе нужна одна из ролей. */
  roles?: AppRole[];
  /** Какое число показать у названия. Пусто — в разделе нечего ждать. */
  count?: CountedSection;
}

// Разделы добавляются по мере готовности экранов: мёртвых ссылок в меню нет.
const NAV: NavItem[] = [
  { href: '/', label: 'Мои поездки', icon: Route, count: 'mine' },
  { href: '/calendar', label: 'Календарь', icon: CalendarDays, roles: ['aho'] },
  {
    href: '/reception',
    label: 'Рецепция',
    icon: KeyRound,
    roles: ['reception', 'aho'],
    count: 'reception',
  },
  {
    href: '/documents',
    label: 'Документы',
    icon: FileText,
    roles: ['finance', 'aho'],
    count: 'documents',
  },
  { href: '/cars', label: 'Машины', icon: Car, roles: ['aho'], count: 'cars' },
  { href: '/drivers', label: 'Водители', icon: UserRound, roles: ['aho'] },
  { href: '/history', label: 'История', icon: History, roles: ['aho'] },
  { href: '/roles', label: 'Роли', icon: ShieldCheck, roles: ['aho'] },
  // Видна всем и стоит последней: нужна редко, но человек, которого никто не
  // учил, должен найти её сам. Из-за неё полоска разделов есть и у сотрудника
  // без ролей — у него в ней два пункта.
  { href: '/help', label: 'Как пользоваться', icon: CircleQuestionMark },
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
  const { counts } = useNavCounts();
  const pathname = usePathname();

  const items = NAV.filter(
    (item) => !item.roles || item.roles.some((role) => employee.roles.includes(role)),
  );

  // Полоска рисуется, когда есть куда переключаться. Раньше у сотрудника без
  // ролей раздел был один, и полоска только дублировала бы закладку Teams.
  // Теперь у него есть ещё «Как пользоваться», и полоска нужна.
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
              {items.map(({ href, label, icon: Icon, count }) => {
                // Число рядом с названием: так работа видна и из другого
                // раздела. Красным — только если внутри есть срочное; обычное
                // дело помечается спокойным серым.
                const section = count && counts ? counts[count] : null;
                const waiting = section?.total ?? 0;
                const urgent = (section?.urgent ?? 0) > 0;
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
                    {waiting > 0 && (
                      <span
                        className={`inline-flex min-w-5 justify-center rounded-full px-1.5 text-xs font-semibold ${
                          urgent
                            ? 'bg-bad text-bad-fg'
                            : 'border border-line-strong bg-surface-soft text-fg-soft'
                        }`}
                        aria-label={`ждут: ${waiting}${urgent ? ', есть срочное' : ''}`}
                      >
                        {waiting}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="flex min-w-0 items-center gap-2">
              <span
                className="hidden truncate text-sm text-fg-soft sm:block"
                title={employee.upn}
              >
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
