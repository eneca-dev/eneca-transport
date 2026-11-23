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

/**
 * Ответ на назначение, нажатый в календаре: `cal:c:109:2026-11-27`.
 *
 * Шаблон лежит рядом с тем, что собирает эти кнопки (`dayRows`), а не в
 * обработчике нажатий: разъедутся — и кнопка перестанет работать молча.
 * `c` — подтверждаю, `n` — не могу; дата нужна, чтобы перерисовать тот же день.
 */
export const ANSWER_PATTERN = /^cal:([cn]):(\d+):(\d{4}-\d{2}-\d{2})$/;

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

/**
 * Чем помечен день.
 *
 * Покрасить кнопку в Telegram нельзя — цвета у inline-клавиатуры нет вовсе.
 * Единственный цвет, который там доступен, — эмодзи в тексте кнопки.
 *
 * Размер эмодзи задаёт клиент Telegram, уменьшить его нельзя. Поэтому крупные
 * кружки (🟡🟢🔴⚪) заменены на знаки, у которых сам рисунок мелкий: 🔸 и 🔹 —
 * единственные цветные эмодзи, нарисованные маленькими внутри своей клетки.
 * Для отсутствия и закрытой поездки взяты текстовые знаки: они ещё меньше,
 * наследуют цвет текста кнопки и поэтому видны и в светлой теме, и в тёмной.
 *
 * Цвет оставлен там, где от водителя могут ждать действия, а неподтверждённая
 * поездка выделяется ещё и формой — это единственный ромб среди меток.
 */
export type DayMark = 'pending' | 'active' | 'away' | 'closed';

export const DAY_MARK: Record<DayMark, string> = {
  pending: '🔸',
  active: '🔹',
  away: '×',
  // Не «·»: этим знаком заполняются пустые клетки сетки, и закрытая поездка
  // стала бы неотличима от дня, которого в месяце нет.
  closed: '✓',
};

export const DAY_MARK_LABEL: Record<DayMark, string> = {
  pending: 'нужно подтвердить',
  active: 'поездка',
  away: 'дни отсутствия',
  closed: 'уже закрыта',
};

/**
 * Что показать, когда на один день приходится несколько пометок.
 *
 * Вперёд идёт то, что требует действия водителя: подтверждение важнее, чем
 * сообщение о самой поездке, а поездка важнее отметки об отсутствии — если
 * они совпали, разбираться с этим всё равно придётся.
 */
const MARK_ORDER: readonly DayMark[] = ['pending', 'active', 'away', 'closed'];

/** Отрезок с пометкой: поездка или период отсутствия. */
export interface MarkedSpan {
  /** Момент или календарная дата — лишь бы `Date` их понимал. */
  startsAt: string;
  endsAt: string;
  mark: DayMark;
}

/**
 * Метки по числам месяца.
 *
 * Проверяется пересечение с сутками, а не дата начала: многодневная поездка
 * занимает каждый свой день, иначе в календаре она выглядела бы однодневной.
 */
export function dayMarks(month: string, spans: MarkedSpan[]): Map<number, DayMark> {
  const marks = new Map<number, DayMark>();

  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const { from, to } = minskDay(`${month}-${pad(day)}`);

    const touching = spans.filter(
      (span) => new Date(span.startsAt) < to && new Date(span.endsAt) >= from,
    );

    if (touching.length === 0) {
      continue;
    }

    const best = MARK_ORDER.find((mark) => touching.some((span) => span.mark === mark));

    if (best) {
      marks.set(day, best);
    }
  }

  return marks;
}

/** Какие метки встретились — для подписи под сеткой. */
export function usedMarks(marks: Map<number, DayMark>): DayMark[] {
  return MARK_ORDER.filter((mark) => [...marks.values()].includes(mark));
}

/**
 * Сетка месяца: заголовок со стрелками, названия дней недели, числа.
 *
 * У помеченного дня кружок стоит после числа: сначала дата, которую ищут
 * глазами, потом цвет. Перед числом кружок сбивал бы чтение колонки.
 */
export function monthGrid(
  month: string,
  marks: Map<number, DayMark>,
  today: string,
): InlineButton[][] {
  const header: InlineButton[] = [
    { text: '‹', data: `cal:m:${shiftMonth(month, -1)}` },
    { text: formatMonthLabel(month), data: 'cal:x' },
    { text: '›', data: `cal:m:${shiftMonth(month, 1)}` },
  ];

  const weekdays: InlineButton[] = WEEKDAY_NAMES.map((name) => ({ text: name, data: 'cal:x' }));

  const cells: InlineButton[] = Array.from({ length: firstWeekdayIndex(month) }, () => FILLER);

  for (let day = 1; day <= daysInMonth(month); day += 1) {
    const date = `${month}-${pad(day)}`;
    const mark = marks.get(day);

    cells.push({
      text: mark ? `${day}${DAY_MARK[mark]}` : String(day),
      data: mark ? `cal:d:${date}` : `cal:f:${date}`,
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

/** Поездка дня в том виде, в каком она важна для кнопок. */
export interface DayTrip {
  tripId: number;
  /** Ждут ли от водителя ответа: подтверждения или отказа. */
  awaitsAnswer: boolean;
}

/**
 * Кнопки под одним днём календаря.
 *
 * Водитель открывает день чаще всего затем, чтобы ответить, — поэтому ответ
 * предлагается здесь же, рядом с возвратом в календарь, а не в прежнем
 * сообщении с назначением, которое надо ещё найти в переписке.
 *
 * Номер поездки появляется в кнопке только тогда, когда ответа в этот день
 * ждут две поездки и больше. При одной он лишний шум: о какой поездке речь,
 * видно из текста над кнопками.
 */
export function dayRows(date: string, trips: DayTrip[]): InlineButton[][] {
  const waiting = trips.filter((trip) => trip.awaitsAnswer);

  const rows: InlineButton[][] = waiting.map((trip) => {
    const suffix = waiting.length > 1 ? ` #${trip.tripId}` : '';

    return [
      { text: `Подтверждаю${suffix}`, data: `cal:c:${trip.tripId}:${date}` },
      { text: `Не могу${suffix}`, data: `cal:n:${trip.tripId}:${date}` },
    ];
  });

  rows.push([{ text: '‹ Календарь', data: `cal:m:${date.slice(0, 7)}` }]);

  return rows;
}
