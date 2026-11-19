'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { APP_TIMEZONE } from '@/config/app';
import { toMinskDate } from '@/modules/trips/booking';

import { loadCalendarRange } from './actions';

import type { CalendarCell, CalendarData, CalendarRow } from './queries';

/**
 * Э6 «Календарь».
 *
 * Таблица: строки — машины и водители, столбцы — дни. Неделя по умолчанию:
 * месяц на узком экране не читается, а АХО смотрит календарь, чтобы понять,
 * что свободно на ближайшие дни.
 */

type Span = 'week' | 'month';

const weekdayFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  weekday: 'short',
});

const monthTitle = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  month: 'long',
  year: 'numeric',
});

/** Понедельник недели, в которую попадает дата. */
function startOfWeek(date: Date): Date {
  const minskDay = new Date(`${toMinskDate(date)}T12:00:00+03:00`);
  const weekday = minskDay.getUTCDay(); // 0 — воскресенье
  const shift = weekday === 0 ? 6 : weekday - 1;
  return new Date(minskDay.getTime() - shift * 24 * 60 * 60 * 1000);
}

function rangeFor(span: Span, anchor: Date): { since: string; until: string } {
  if (span === 'week') {
    const from = startOfWeek(anchor);
    return {
      since: toMinskDate(from),
      until: toMinskDate(new Date(from.getTime() + 6 * 24 * 60 * 60 * 1000)),
    };
  }

  const month = toMinskDate(anchor).slice(0, 7);
  const first = new Date(`${month}-01T12:00:00+03:00`);
  const nextMonth = new Date(first.getTime());
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const last = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000);

  return { since: `${month}-01`, until: toMinskDate(last) };
}

const CELL_CLASS: Record<CalendarCell['kind'], string> = {
  trip: 'bg-brand text-brand-fg',
  repair: 'bg-warn text-warn-fg',
  away: 'bg-bad text-bad-fg',
};

function Cells({ cells }: { cells: CalendarCell[] | undefined }) {
  if (!cells || cells.length === 0) {
    return <span className="text-fg-soft">—</span>;
  }

  return (
    <span className="flex flex-wrap justify-center gap-0.5">
      {cells.map((cell, index) => {
        const content = (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${CELL_CLASS[cell.kind]}`}
          >
            {cell.label}
          </span>
        );

        return cell.tripId ? (
          <Link key={`${cell.label}-${index}`} href={`/trips/${cell.tripId}`}>
            {content}
          </Link>
        ) : (
          <span key={`${cell.label}-${index}`}>{content}</span>
        );
      })}
    </span>
  );
}

function Section({
  title,
  rows,
  dates,
  empty,
}: {
  title: string;
  rows: CalendarRow[];
  dates: string[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <tbody>
        <tr>
          <th
            colSpan={dates.length + 1}
            className="border-t border-line bg-surface-soft px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-fg-soft uppercase"
          >
            {title}
          </th>
        </tr>
        <tr>
          <td colSpan={dates.length + 1} className="px-3 py-3 text-sm text-fg-soft">
            {empty}
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      <tr>
        <th
          colSpan={dates.length + 1}
          className="border-t border-line bg-surface-soft px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-fg-soft uppercase"
        >
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-line">
          <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-normal">
            <span className="block text-sm font-medium whitespace-nowrap">{row.title}</span>
            {row.subtitle && (
              <span className="block font-mono text-xs text-fg-soft">{row.subtitle}</span>
            )}
          </th>
          {dates.map((date) => (
            <td key={date} className="px-1.5 py-2 text-center">
              <Cells cells={row.days[date]} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function CalendarScreen() {
  const { getToken } = useTeamsAuth();

  const [span, setSpan] = useState<Span>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const range = rangeFor(span, anchor);

  const load = useCallback(
    (since: string, until: string) => {
      startTransition(async () => {
        try {
          const result = await loadCalendarRange(await getToken(), { since, until });
          if (result.success) {
            setData(result.data);
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
    load(range.since, range.until);
  }, [load, range.since, range.until]);

  /** Шаг листания: неделя или месяц. */
  function step(direction: -1 | 1) {
    const next = new Date(anchor);
    if (span === 'week') {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }
    setAnchor(next);
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          Календарь · {monthTitle.format(new Date(`${range.since}T12:00:00+03:00`))}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={pending}
            aria-label="Назад"
            className={BUTTON_SECONDARY}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            disabled={pending}
            className={BUTTON_SECONDARY}
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={pending}
            aria-label="Вперёд"
            className={BUTTON_SECONDARY}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>

          <span className="ml-2 flex overflow-hidden rounded-md border border-line-strong">
            {(['week', 'month'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpan(option)}
                disabled={pending}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  span === option
                    ? 'bg-brand font-medium text-brand-fg'
                    : 'bg-surface text-fg-soft hover:bg-surface-soft'
                }`}
              >
                {option === 'week' ? 'Неделя' : 'Месяц'}
              </button>
            ))}
          </span>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {data === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {data && (
        <>
          {/* Таблица прокручивается вбок: месяц в 31 столбец на экран не влезет,
              а сжимать столбцы до нечитаемых — хуже прокрутки. */}
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface px-3 py-2 text-left text-xs font-semibold text-fg-soft">
                    Машина, водитель
                  </th>
                  {data.dates.map((date) => {
                    const day = new Date(`${date}T12:00:00+03:00`);
                    const isToday = date === toMinskDate(new Date());
                    return (
                      <th
                        key={date}
                        className={`px-1.5 py-2 text-center text-xs font-medium whitespace-nowrap ${
                          isToday ? 'text-brand-text' : 'text-fg-soft'
                        }`}
                      >
                        <span className="block">{weekdayFormat.format(day)}</span>
                        <span className="block">{date.slice(8)}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <Section
                title="Машины"
                rows={data.cars}
                dates={data.dates}
                empty="В справочнике нет машин."
              />
              <Section
                title="Водители"
                rows={data.drivers}
                dates={data.dates}
                empty="В справочнике нет водителей."
              />
            </table>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-soft">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded bg-brand" aria-hidden />
              поездка
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded bg-warn" aria-hidden />
              ремонт
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded bg-bad" aria-hidden />
              водитель недоступен
            </span>
            <span>Номер поездки открывается по нажатию.</span>
          </p>
        </>
      )}
    </section>
  );
}
