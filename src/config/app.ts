/** Публичные настройки приложения. Доступны и на сервере, и в браузере. */

export const APP_NAME = 'ЭНЭКА.Командировки';

/**
 * Бот водителей в Telegram (@eneca_trips_bot, создан 13.11). Ссылку АХО даёт
 * водителю при подключении: написать боту первым должен он, иначе Telegram
 * не пропустит ни одного сообщения о поездках.
 */
export const TELEGRAM_BOT_USERNAME = 'eneca_trips_bot';

export const TELEGRAM_BOT_LINK = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

/** Часовой пояс, в котором пользователи видят все даты и время. */
export const APP_TIMEZONE = 'Europe/Minsk';

/** Домен, с которого отдаётся приложение. Должен совпадать с App ID URI в Entra. */
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? '';

export const APP_URL = APP_DOMAIN ? `https://${APP_DOMAIN}` : '';

export const ENTRA_CLIENT_ID = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '';

/**
 * Application ID URI. Для приложения с ботом и вкладкой Microsoft требует
 * формат api://<домен>/botid-<client-id>, а не api://<домен>/<client-id>.
 */
export const APP_ID_URI = `api://${APP_DOMAIN}/botid-${ENTRA_CLIENT_ID}`;

/**
 * Ссылки из чата на вкладку.
 *
 * Открывается не браузер, а вкладка приложения: `entityId` совпадает с тем,
 * что объявлен в манифесте (`trips`), а куда именно идти — передаётся в
 * `context` и читается вкладкой из `app.getContext().page.subPageId`.
 *
 * Бот не может сам переключить человеку вкладку: в Teams такого нет. Он может
 * только дать ссылку, по которой человек нажмёт сам.
 */

/**
 * Экраны, на которые ведут ссылки из чата.
 *
 * Список закрытый намеренно: `subEntityId` приходит снаружи, и подставлять
 * его в путь как есть нельзя.
 */
export const TAB_SCREENS = {
  new: '/trips/new',
  reception: '/reception',
  documents: '/documents',
  calendar: '/calendar',
  history: '/history',
  cars: '/cars',
  drivers: '/drivers',
} as const;

export type TabScreen = keyof typeof TAB_SCREENS;

function entityLink(context?: Record<string, string>): string {
  const base = `https://teams.microsoft.com/l/entity/${ENTRA_CLIENT_ID}/trips`;
  return context ? `${base}?context=${encodeURIComponent(JSON.stringify(context))}` : base;
}

/** Вкладка: её начало или сразу нужный экран. */
export function screenDeepLink(screen?: TabScreen): string {
  return screen ? entityLink({ subEntityId: `screen-${screen}` }) : entityLink();
}

/** Карточка конкретной поездки. */
export function tripDeepLink(tripId: number): string {
  return entityLink({ subEntityId: `trip-${tripId}` });
}
/** Буфер на подготовку автомобиля между поездками. Дублируется в fn_booking_buffer(). */
export const BOOKING_BUFFER_MINUTES = 10;

/**
 * Часы напоминаний по минскому времени.
 *
 * 17:00 накануне выезда — из требований дословно, менять нельзя.
 *
 * Утренние часы в требованиях не заданы: там «каждое утро» и «до утра».
 * Оба стоят на 9:00 — когда рецепция открывается. Раньше смысла нет: экран Э4
 * показывает сегодняшние выдачи и без карточки, а push в семь утра приходит
 * человеку домой до начала рабочего дня.
 */
export const REMINDER_EVE_HOUR = 17;

export const RECEPTION_MORNING_HOUR = 9;

export const OVERDUE_REMINDER_HOUR = 9;

/** Сколько минут водителю даётся на подтверждение назначения (Т1). */
export const DRIVER_CONFIRMATION_MINUTES = 15;

/**
 * Рабочее время по Минску. Нужно напоминаниям, которые просят человека
 * что-то сделать: просить в субботу сдать ключи на закрытую рецепцию —
 * значит приучить не читать такие сообщения вовсе.
 *
 * Праздники и перенесённые рабочие субботы здесь не учитываются: для этого
 * нужен календарь праздников Беларуси, который кто-то должен обновлять
 * каждый год. Неработающий календарь врал бы круглый год, а без него лишнее
 * напоминание приходит только в праздник.
 */
export const WORK_DAY_START_HOUR = 9;

export const WORK_DAY_END_HOUR = 19;

/**
 * Насколько близкий выезд считается срочным.
 *
 * Вне рабочего времени мы молчим — но не тогда, когда выезд уже вот-вот.
 * Шестнадцать часов покрывают случай «назначили вечером, выезжать утром».
 */
export const URGENT_DEPARTURE_HOURS = 16;
