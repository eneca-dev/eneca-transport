import { formatMonthLabel } from '@/lib/datetime';
import { fromMinskInput, toMinskDate } from '@/modules/trips/booking';

import type { InlineButton } from '@/lib/bots/telegram';

/**
 * Арифметика календаря водителя: месяцы, дни, сетка кнопок.
 *
 * Обращений к базе здесь нет намеренно — как в `booking.ts`. Смещение первого
 * числа, число дней в месяце и переход через декабрь ошибаются молча: сетка
 * отрисуется, просто числа встанут не под теми днями недели. Поэтому всё это
 * должно проверяться без приложения и без базы.
 */

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Понедельник первым: в Беларуси неделя начинается с него. */
const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Пустая клетка сетки. Telegram не принимает кнопку без текста. */
const FILLER: InlineButton = { text: '·', data: 'cal:x' };

const pad = (value: number): string => String(value).padStart(2, '0');

/** Минский месяц, в котором мы сейчас: «2026-11». */
export function currentMinskMonth(): string {
  return toMinskDate(new Date()).slice(0, 7);
}

/**
 * Сдвиг месяца вперёд или назад.
 *
 * Остаток от деления в JS бывает отрицательным, поэтому месяц приводится к
 * 0–11 явно: без этого шаг назад с января давал бы «2026-00».
 */
export function shiftMonth(month: string, step: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + step;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = ((index % 12) + 12) % 12;
  return `${shiftedYear}-${pad(shiftedMonth + 1)}`;
}

/** Сколько дней в месяце. Нулевой день следующего — последний текущего. */
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** Границы минских суток, в которые попадает календарная дата. */
export function minskDay(date: string): { from: Date; to: Date } {
  const from = fromMinskInput(date, '00:00');

  if (!from) {
    throw new Error(`Не удалось определить сутки ${date}`);
  }

  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/** Границы минского месяца. */
export function minskMonth(month: string): { from: Date; to: Date } {
  return { from: minskDay(`${month}-01`).from, to: minskDay(`${shiftMonth(month, 1)}-01`).from };
}

/**
 * День недели первого числа, где понедельник — 0.
 *
 * Календарная дата разбирается как UTC-полночь: день недели у неё один и тот
 * же в любом часовом поясе, а сдвиг зоны сломал бы первую клетку.
 */
export function firstWeekdayIndex(month: string): number {
  return (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Отрезок поездки — только начало и конец, остальное сетке не нужно. */
export interface Span {
  startsAt: string;
  endsAt: string;
}

/**
 * Числа месяца, на которые попадает хотя бы одна поездка.
 *
 * Проверяется пересечение с сутками, а не дата начала: многодневная поездка
 * занимает каждый свой день, иначе в календаре она выглядела бы однодневной.
 */
export function busyDays(month: string, spans: Span[]): Set<number> {
  const busy = new Set<number>();

  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const { from, to } = minskDay(`${month}-${pad(day)}`);

    const touched = spans.some(
      (span) => new Date(span.startsAt) < to && new Date(span.endsAt) >= from,
    );

    if (touched) {
      busy.add(day);
    }
  }

  return busy;
}

/**
 * Сетка месяца: заголовок со стрелками, названия дней недели, числа.
 *
 * Занятые дни — в квадратных скобках, а не значком: кнопка в Telegram узкая,
 * и скобки читаются одинаково на любом телефоне и в любой теме.
 */
export function monthGrid(month: string, busy: Set<number>, today: string): InlineButton[][] {
  const header: InlineButton[] = [
    { text: '‹', data: `cal:m:${shiftMonth(month, -1)}` },
    { text: formatMonthLabel(month), data: 'cal:x' },
    { text: '›', data: `cal:m:${shiftMonth(month, 1)}` },
  ];

  const weekdays: InlineButton[] = WEEKDAY_NAMES.map((name) => ({ text: name, data: 'cal:x' }));

  const cells: InlineButton[] = Array.from({ length: firstWeekdayIndex(month) }, () => FILLER);

  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${pad(day)}`;
    const isBusy = busy.has(day);

    cells.push({
      text: isBusy ? `[${day}]` : String(day),
      data: isBusy ? `cal:d:${date}` : `cal:f:${date}`,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(FILLER);
  }

  const weeks: InlineButton[][] = [];
  for (let start = 0; start < cells.length; start += 7) {
    weeks.push(cells.slice(start, start + 7));
  }

  const rows = [header, weekdays, ...weeks];

  // Кнопка «Сегодня» нужна только когда открыт другой месяц: иначе она ничего
  // не делает, и водитель решает, что бот сломался.
  if (month !== today) {
    rows.push([{ text: 'Сегодня', data: `cal:m:${today}` }]);
  }

  return rows;
}
