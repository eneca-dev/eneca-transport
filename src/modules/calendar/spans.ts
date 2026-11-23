import { formatDay } from '@/lib/datetime';
import { minskDayBounds, toMinskDate } from '@/modules/trips/booking';

/**
 * Арифметика полос календаря: дни периода, обрезка по краям, дорожки.
 *
 * Обращений к базе здесь нет намеренно — как в `booking.ts` и
 * `drivers/calendarGrid`. Ошибка на один день не падает: полоса просто
 * встанет не над тем числом или окажется короче, чем занятость. Увидеть это
 * глазами в тридцати одной колонке невозможно, поэтому проверяться должно
 * без приложения.
 *
 * Даты сравниваются как строки «ГГГГ-ММ-ДД»: в этом виде лексикографический
 * порядок совпадает с календарным, и разбирать их в `Date` не нужно.
 */

/** Все минские даты от начала до конца включительно. */
export function datesBetween(since: string, until: string): string[] {
  const dates: string[] = [];
  let cursor = minskDayBounds(new Date(`${since}T12:00:00+03:00`)).from;
  const last = minskDayBounds(new Date(`${until}T12:00:00+03:00`)).from;

  // Защита от бесконечного цикла при перевёрнутом периоде.
  while (cursor <= last && dates.length < 120) {
    dates.push(toMinskDate(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}

export interface Bounds {
  from: string;
  to: string;
  openStart: boolean;
  openEnd: boolean;
}

/**
 * Обрезать занятость по показанному периоду.
 *
 * `null` значит, что в период она не попала вовсе. Флаги `openStart` и
 * `openEnd` говорят календарю нарисовать полосу срезанной: без них
 * трёхнедельный ремонт выглядит как недельный, и кажется, что машина
 * освободится в субботу.
 *
 * `last === null` — ремонт без срока окончания.
 */
export function clip(first: string, last: string | null, dates: string[]): Bounds | null {
  if (dates.length === 0) {
    return null;
  }

  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  if (first > periodEnd || (last !== null && last < periodStart)) {
    return null;
  }

  return {
    from: first < periodStart ? periodStart : first,
    to: last === null || last > periodEnd ? periodEnd : last,
    openStart: first < periodStart,
    openEnd: last === null || last > periodEnd,
  };
}

/** «02.12 – 09.12», «02.12» для одного дня, «с 02.12, без срока» для ремонта. */
export function dateRange(since: string, until: string | null): string {
  const from = formatDay(new Date(`${since}T12:00:00+03:00`));

  if (until === null) {
    return `с ${from}, без срока`;
  }

  const to = formatDay(new Date(`${until}T12:00:00+03:00`));
  return from === to ? from : `${from} – ${to}`;
}

/** Заглавная первая буква: «отпуск» → «Отпуск». */
export function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

/** Выходной по минскому календарю. */
export function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Разложить занятость по дорожкам, чтобы пересекающееся не легло друг на друга.
 *
 * Две поездки у одной машины пересечься не могут — это запрещено базой. Но
 * ремонт и поездка пересечься могут, и именно это нужно увидеть: машина
 * занята и там, и там. Такая пара уедет на вторую дорожку, а не спрячется.
 */
export function toLanes<T extends { from: string; to: string }>(spans: T[]): T[][] {
  const sorted = [...spans].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  const lanes: T[][] = [];

  for (const span of sorted) {
    const lane = lanes.find((items) => items[items.length - 1].to < span.from);

    if (lane) {
      lane.push(span);
    } else {
      lanes.push([span]);
    }
  }

  return lanes;
}
