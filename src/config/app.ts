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
 * Ссылка на поездку внутри Teams — для кнопки «Открыть» в карточках бота.
 *
 * Открывается не браузер, а вкладка приложения: `entityId` совпадает с тем,
 * что объявлен в манифесте (`trips`), а номер поездки передаётся в `context`
 * и читается вкладкой из `app.getContext().page.subPageId`.
 */
/** Ссылка на саму вкладку, без конкретной поездки. */
export function screenDeepLink(): string {
  return `https://teams.microsoft.com/l/entity/${ENTRA_CLIENT_ID}/trips`;
}

export function tripDeepLink(tripId: number): string {
  const context = encodeURIComponent(JSON.stringify({ subEntityId: `trip-${tripId}` }));
  return (
    `https://teams.microsoft.com/l/entity/${ENTRA_CLIENT_ID}/trips` +
    `?context=${context}`
  );
}
/** Буфер на подготовку автомобиля между поездками. Дублируется в fn_booking_buffer(). */
export const BOOKING_BUFFER_MINUTES = 10;

/**
 * Часы напоминаний по минскому времени.
 *
 * 17:00 накануне выезда — из требований дословно. Утренняя сводка рецепции и
 * напоминание о несданных ключах времени в требованиях не имеют: взяты так,
 * чтобы сводка пришла до начала выдач, а о ключах напомнило после.
 */
export const REMINDER_EVE_HOUR = 17;

export const RECEPTION_MORNING_HOUR = 7;

export const OVERDUE_REMINDER_HOUR = 8;

/** Сколько минут водителю даётся на подтверждение назначения (Т1). */
export const DRIVER_CONFIRMATION_MINUTES = 15;
