import { APP_TIMEZONE, BOOKING_BUFFER_MINUTES } from '@/config/app';

/**
 * Интервал брони и работа со временем поездки.
 *
 * Здесь нет обращений к базе намеренно: это единственное место, где записана
 * формула занятого интервала, и она должна проверяться без базы. Если формула
 * здесь разойдётся с триггером `fn_trips_booking_during`, экран начнёт
 * предлагать машину, которую база тут же отвергнет.
 *
 * Проверено на живой базе 19.11: запрос и ограничение отвечают одинаково на
 * восьми границах — 5, 9 и 10 минут после брони, столько же до неё, а также
 * интервал внутри брони и накрывающий её целиком.
 */

/**
 * Занятый интервал: от выезда до возврата плюс буфер, правая граница открытая.
 * Повторяет `fn_trips_booking_during()`: `tstzrange(starts_at, ends_at + 10
 * минут, '[)')`.
 *
 * Буфер прибавляется только справа, но действует с двух сторон: новая поездка
 * тоже растягивает свой интервал на 10 минут вперёд, поэтому закончиться она
 * должна не позже чем за 10 минут до выезда следующей.
 */
export function bookingRange(startsAt: Date, endsAt: Date): string {
  const freeFrom = addMinutes(endsAt, BOOKING_BUFFER_MINUTES);
  return `[${startsAt.toISOString()},${freeFrom.toISOString()})`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Когда машина освободится после этой поездки. */
export function freeFrom(endsAt: Date): Date {
  return addMinutes(endsAt, BOOKING_BUFFER_MINUTES);
}

/**
 * Минск круглый год UTC+3: перехода на летнее время с 2011 года нет. Поэтому
 * смещение задано числом, а не вычисляется — так однозначнее. Если Беларусь
 * когда-нибудь вернёт переход, менять нужно только эту строку.
 */
const MINSK_OFFSET = '+03:00';

/**
 * Время, введённое человеком в Э2, в момент на оси времени.
 * `date` — «2026-11-25», `time` — «07:00». Введённое читается как минское.
 */
export function fromMinskInput(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00${MINSK_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const dateParts = new Intl.DateTimeFormat('ru-RU', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Календарная дата по минскому времени, «2026-11-25».
 *
 * Нужна для периодов недоступности водителя: они хранятся датами без времени,
 * и сравнивать их надо с минским днём, а не с днём по UTC. Поездка, начатая в
 * 01:00 по Минску, по UTC приходится на предыдущие сутки.
 */
/**
 * Начало и конец минских суток, в которые попадает момент.
 *
 * Нужно экрану рецепции: «выдачи и возвраты на сегодня» — это минские сутки, а
 * не сутки по UTC. Возврат в 01:00 по Минску приходится на предыдущие сутки
 * UTC, и без этого он попал бы во вчерашний список.
 */
export function minskDayBounds(date: Date): { from: Date; to: Date } {
  const day = toMinskDate(date);
  const from = fromMinskInput(day, '00:00');

  if (!from) {
    throw new Error(`Не удалось определить сутки для ${date.toISOString()}`);
  }

  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export function toMinskDate(date: Date): string {
  const parts = dateParts.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
