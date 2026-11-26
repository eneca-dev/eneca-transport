'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { APP_TIMEZONE } from '@/config/app';
import { toMinskDate } from '@/modules/trips/booking';

import { loadCalendarRange } from './actions';
import { isWeekend, toLanes } from './spans';

import type { CalendarData, CalendarRow, CalendarSpan, SpanKind } from './queries';

/**
 * Э6 «Календарь».
 *
 * Занятость показана полосами: многодневная поездка или ремонт — одна полоса
 * через все свои дни, а не подпись, повторённая в каждой клетке. Что это
 * такое, говорит цвет; подробности — в подсказке при наведении и по нажатию.
 *
 * Подписей в полосах нет намеренно. Колонка дня шириной в два символа не
 * вмещает ни «ремонт», ни «#127», зато слово растягивает колонку и месяц
 * перестаёт влезать на экран.
 *
 * Неделя по умолчанию: АХО смотрит календарь, чтобы понять, что свободно на
 * ближайшие дни.
 */

type Span = 'day' | 'week' | 'month';

const weekdayFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  weekday: 'short',
});

const dayTitle = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const monthTitle = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  month: 'long',
  year: 'numeric',
});

const MARK_CLASS: Record<SpanKind, string> = {
  trip: 'bg-mark-busy',
  repair: 'bg-mark-repair',
  away: 'bg-mark-away',
};

const MARK_LABEL: Record<SpanKind, string> = {
  trip: 'поездка',
  repair: 'ремонт',
  away: 'водитель не работает',
};

/** Понедельник недели, в которую попадает дата. */
function startOfWeek(date: Date): Date {
  const minskDay = new Date(`${toMinskDate(date)}T12:00:00+03:00`);
  const weekday = minskDay.getUTCDay(); // 0 — воскресенье
  const shift = weekday === 0 ? 6 : weekday - 1;
  return new Date(minskDay.getTime() - shift * 24 * 60 * 60 * 1000);
}

function rangeFor(span: Span, anchor: Date): { since: string; until: string } {
  if (span === 'day') {
    const day = toMinskDate(anchor);
    return { since: day, until: day };
  }

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

interface Hint {
  span: CalendarSpan;
  x: number;
  y: number;
}

interface BarsProps {
  row: CalendarRow;
  dates: string[];
  columns: string;
  onHint: (hint: Hint | null) => void;
}

function Bars({ row, dates, columns, onHint }: BarsProps) {
  const router = useRouter();
  const lanes = toLanes(row.spans);
  const height = Math.max(lanes.length, 1);

  const show = (span: CalendarSpan, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    onHint({ span, x: box.left + box.width / 2, y: box.top });
  };

  return (
    <div
      className="grid gap-y-1 border-t border-line py-1.5"
      style={{ gridTemplateColumns: columns, gridAutoRows: '1.375rem' }}
    >
      <div
        className="sticky left-0 z-10 flex flex-col justify-center bg-surface px-3"
        style={{ gridColumn: 1, gridRow: `1 / span ${height}` }}
      >
        <span className="text-sm leading-tight font-medium">{row.title}</span>
        {row.subtitle && (
          <span className="font-mono text-xs leading-tight text-fg-soft">{row.subtitle}</span>
        )}
      </div>

      {/* Подложка дней: выходные затенены, чтобы колонки читались без линий. */}
      {dates.map((date, index) => (
        <div
          key={date}
          aria-hidden
          className={isWeekend(date) ? 'bg-surface-soft' : ''}
          style={{ gridColumn: index + 2, gridRow: `1 / span ${height}` }}
        />
      ))}

      {lanes.map((lane, laneIndex) =>
        lane.map((span) => {
          const start = dates.indexOf(span.from);
          const length = dates.indexOf(span.to) - start + 1;

          if (start < 0 || length < 1) {
            return null;
          }

          const edges = [
            span.openStart ? 'rounded-l-none' : 'rounded-l-sm',
            span.openEnd ? 'rounded-r-none' : 'rounded-r-sm',
          ].join(' ');

          return (
            <button
              key={span.key}
              type="button"
              className={`mx-px h-full ${edges} ${MARK_CLASS[span.kind]} transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none`}
              style={{ gridColumn: `${start + 2} / span ${length}`, gridRow: laneIndex + 1 }}
              aria-label={`${MARK_LABEL[span.kind]}: ${span.title}, ${span.when}`}
              onMouseEnter={(event) => show(span, event.currentTarget)}
              onMouseLeave={() => onHint(null)}
              onFocus={(event) => show(span, event.currentTarget)}
              onBlur={() => onHint(null)}
              onClick={(event) => {
                // Поездка открывается, остальное только показывает подсказку —
                // на телефоне наведения нет, и нажатие единственный способ её
                // увидеть.
                if (span.tripId) {
                  router.push(`/trips/${span.tripId}`);
                } else {
                  show(span, event.currentTarget);
                }
              }}
            />
          );
        }),
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="border-t border-line bg-surface-soft px-3 py-1.5 text-xs font-semibold tracking-wide text-fg-soft uppercase">
      {children}
    </p>
  );
}

export function CalendarScreen() {
  const { getToken } = useTeamsAuth();

  const [span, setSpan] = useState<Span>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
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

  // Подсказка стоит в координатах окна, поэтому при прокрутке страницы она
  // отрывается от полосы. Проще убрать, чем пересчитывать.
  useEffect(() => {
    if (!hint) {
      return;
    }

    const hide = () => setHint(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hint]);

  /** Шаг листания: сутки, неделя или месяц. */
  function step(direction: -1 | 1) {
    const next = new Date(anchor);
    if (span === 'day') {
      next.setDate(next.getDate() + direction);
    } else if (span === 'week') {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }
    setAnchor(next);
  }

  const dates = data?.dates ?? [];
  const columns = `minmax(9rem, 11rem) repeat(${dates.length}, minmax(1.75rem, 1fr))`;
  const today = toMinskDate(new Date());

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          Календарь ·{' '}
          {span === 'day'
            ? dayTitle.format(new Date(`${range.since}T12:00:00+03:00`))
            : monthTitle.format(new Date(`${range.since}T12:00:00+03:00`))}
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
            {(['day', 'week', 'month'] as const).map((option) => (
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
                {option === 'day' ? 'День' : option === 'week' ? 'Неделя' : 'Месяц'}
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

      {data && span === 'day' && <DayList data={data} />}

      {data && span !== 'day' && (
        <>
          {/* Прокручивается вбок: месяц в 31 колонку на узкий экран не влезет,
              а сжимать колонки до нечитаемых — хуже прокрутки. */}
          <div
            className="overflow-x-auto rounded-lg border border-line bg-surface"
            onScroll={() => setHint(null)}
          >
            <div className="min-w-max">
              <div className="grid" style={{ gridTemplateColumns: columns }}>
                <div className="sticky left-0 z-10 bg-surface px-3 py-2 text-xs font-semibold text-fg-soft">
                  Машина, водитель
                </div>
                {dates.map((date) => {
                  const day = new Date(`${date}T12:00:00+03:00`);
                  const isToday = date === today;

                  return (
                    <div
                      key={date}
                      className={`py-2 text-center text-xs whitespace-nowrap ${
                        isToday
                          ? 'font-semibold text-brand-text'
                          : isWeekend(date)
                            ? 'bg-surface-soft text-fg-soft'
                            : 'text-fg-soft'
                      }`}
                    >
                      <span className="block">{weekdayFormat.format(day)}</span>
                      <span className="block tabular-nums">{date.slice(8)}</span>
                    </div>
                  );
                })}
              </div>

              <SectionTitle>Машины</SectionTitle>
              {data.cars.length === 0 ? (
                <p className="px-3 py-3 text-sm text-fg-soft">В справочнике нет машин.</p>
              ) : (
                data.cars.map((row) => (
                  <Bars
                    key={row.id}
                    row={row}
                    dates={dates}
                    columns={columns}
                    onHint={setHint}
                  />
                ))
              )}

              <SectionTitle>Водители</SectionTitle>
              {data.drivers.length === 0 ? (
                <p className="px-3 py-3 text-sm text-fg-soft">В справочнике нет водителей.</p>
              ) : (
                data.drivers.map((row) => (
                  <Bars
                    key={row.id}
                    row={row}
                    dates={dates}
                    columns={columns}
                    onHint={setHint}
                  />
                ))
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-soft">
            {(Object.keys(MARK_LABEL) as SpanKind[]).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span className={`inline-block size-2.5 rounded-full ${MARK_CLASS[kind]}`} aria-hidden />
                {MARK_LABEL[kind]}
              </span>
            ))}
            <span>Наведите на полосу — покажу подробности. Поездка открывается нажатием.</span>
          </div>
        </>
      )}

      {hint && <HintBox hint={hint} />}
    </section>
  );
}

/**
 * День — списком, а не сеткой.
 *
 * Сетка в одну колонку выродилась бы в столбик цветных квадратов без единой
 * подписи: подробности в ней живут в подсказке при наведении, а наводить
 * некуда. В списке всё написано сразу — время, маршрут, водитель.
 *
 * Пустые строки пропускаются: смысл дня в том, что занято, а свободные машины
 * считаются взглядом по тому, чего в списке нет.
 */
function DayList({ data }: { data: CalendarData }) {
  const router = useRouter();
  const rows = [...data.cars, ...data.drivers].filter((row) => row.spans.length > 0);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg-soft">
        В этот день ничего не запланировано.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {rows.map((row) => (
        <li key={`${row.id}-${row.title}`} className="px-4 py-3">
          <p className="text-sm font-medium">
            {row.title}
            {row.subtitle && <span className="ml-2 text-fg-soft">{row.subtitle}</span>}
          </p>

          <ul className="mt-1 space-y-1">
            {row.spans.map((span) => (
              <li key={span.key}>
                <button
                  type="button"
                  disabled={span.tripId === null}
                  onClick={() => span.tripId !== null && router.push(`/trips/${span.tripId}`)}
                  className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-sm enabled:hover:bg-surface-soft"
                >
                  <span
                    className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${MARK_CLASS[span.kind]}`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block">{span.title}</span>
                    <span className="block text-fg-soft">
                      {span.when}
                      {span.detail && ` · ${span.detail}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Подсказка о полосе.
 *
 * Стоит в координатах окна, а не внутри таблицы: таблица прокручивается вбок,
 * и подсказку внутри неё обрезало бы по краю.
 */
function HintBox({ hint }: { hint: Hint }) {
  const { span } = hint;
  const margin = 140;
  const x = Math.min(Math.max(hint.x, margin), window.innerWidth - margin);

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: x, top: hint.y - 8 }}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <span className={`inline-block size-2 shrink-0 rounded-full ${MARK_CLASS[span.kind]}`} aria-hidden />
        {span.title}
      </p>
      <p className="mt-0.5 text-fg-soft">{span.when}</p>
      {span.detail && <p className="mt-0.5 text-fg-soft">{span.detail}</p>}
    </div>
  );
}
