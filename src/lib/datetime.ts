import { APP_TIMEZONE } from '@/config/app';

/**
 * Даты и время в минском времени — одним набором на всё приложение.
 *
 * Собрано в одном месте не ради краткости: форматирование разъезжается само.
 * Один экран показывал бы «25.11, 07:00», другой «25.11 07:00», третий —
 * московское время, если бы кто-то забыл указать зону.
 *
 * Запятую, которую русская локаль ставит между датой и временем, убираем:
 * в диапазоне «25.11, 07:00 – 26.11, 19:00» она сбивает чтение.
 */

const full = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function part(date: Date, type: Intl.DateTimeFormatPartTypes): string {
  return full.formatToParts(date).find((item) => item.type === type)?.value ?? '';
}

/** «25.11» */
export function formatDay(date: Date): string {
  return `${part(date, 'day')}.${part(date, 'month')}`;
}

/** «07:00» */
export function formatTime(date: Date): string {
  return `${part(date, 'hour')}:${part(date, 'minute')}`;
}

/** «25.11 07:00» */
export function formatMoment(date: Date): string {
  return `${formatDay(date)} ${formatTime(date)}`;
}

/** «25.11 07:00 – 26.11 19:00» */
export function formatPeriod(from: Date, to: Date): string {
  return `${formatMoment(from)} – ${formatMoment(to)}`;
}

/**
 * Диапазон дней: «05–06.11» для многодневного, «12.11» для однодневного.
 * Месяц не повторяется, если он один и тот же.
 */
export function formatDayRange(from: Date, to: Date): string {
  const fromDay = part(from, 'day');
  const fromMonth = part(from, 'month');
  const toDay = part(to, 'day');
  const toMonth = part(to, 'month');

  if (fromDay === toDay && fromMonth === toMonth) {
    return `${fromDay}.${fromMonth}`;
  }
  if (fromMonth === toMonth) {
    return `${fromDay}–${toDay}.${toMonth}`;
  }
  return `${fromDay}.${fromMonth}–${toDay}.${toMonth}`;
}
