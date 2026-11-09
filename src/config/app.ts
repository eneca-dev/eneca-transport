/** Публичные настройки приложения. Доступны и на сервере, и в браузере. */

export const APP_NAME = 'ЭНЭКА.Командировки';

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

/** Буфер на подготовку автомобиля между поездками. Дублируется в fn_booking_buffer(). */
export const BOOKING_BUFFER_MINUTES = 10;

/** Сколько минут водителю даётся на подтверждение назначения (Т1). */
export const DRIVER_CONFIRMATION_MINUTES = 15;
