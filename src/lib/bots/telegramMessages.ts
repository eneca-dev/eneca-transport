import { DRIVER_CONFIRMATION_MINUTES } from '@/config/app';
import { formatPeriod } from '@/lib/datetime';

/**
 * Тексты сообщений Telegram-бота водителя (Т1–Т6).
 *
 * Без разметки: у водителя телефон, и сообщение должно читаться с первого
 * взгляда, без форматирования, которое Telegram может не показать.
 */

export interface AssignmentMessage {
  tripId: number;
  startsAt: string;
  endsAt: string;
  route: string;
  carLabel: string | null;
  passengers: string[];
}

/** Т1: водителя назначили на поездку. */
export function messageT1(trip: AssignmentMessage): string {
  const lines = [
    `Поездка #${trip.tripId}`,
    formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt)),
    trip.route,
    '',
    `Машина: ${trip.carLabel ?? 'не указана'}`,
    `Пассажиры: ${trip.passengers.length > 0 ? trip.passengers.join(', ') : 'нет'}`,
    '',
    `Подтвердите, пожалуйста, в течение ${DRIVER_CONFIRMATION_MINUTES} минут.`,
  ];
  return lines.join('\n');
}

/**
 * Т2: водитель не ответил за 15 минут.
 *
 * Текст из требований почти дословно. Упрёка в нём нет намеренно: водитель мог
 * быть за рулём, и виноватым себя чувствовать не должен.
 */
export function messageT2(tripId: number): string {
  return [
    `Поездка #${tripId}: подтверждение не получено.`,
    '',
    'АХО уведомлено для решения вопроса о замене водителя.',
  ].join('\n');
}

/** Чем заменить Т1 после ответа: кнопки убираются, выбор остаётся в тексте. */
export function messageT1Answered(trip: AssignmentMessage, confirmed: boolean): string {
  const tail = confirmed
    ? 'Вы подтвердили поездку. Напомню накануне выезда.'
    : 'Вы отказались от поездки. АХО уведомлено и назначит замену.';

  return [messageT1(trip).split('\n').slice(0, -2).join('\n'), '', tail].join('\n');
}

/**
 * Т5: возврат по шагам.
 *
 * Разговор ведётся короткими сообщениями, а не одной формой: у водителя
 * телефон, и заполнять три поля в одном сообщении неудобно.
 */

export function messageT5Odometer(
  tripId: number,
  route: string,
  odometerStartKm: number,
): string {
  return [
    `Поездка #${tripId} ${route}. Время возврата.`,
    '',
    'Введите показание одометра.',
    `Начальное — ${odometerStartKm.toLocaleString('ru-RU')} км.`,
  ].join('\n');
}

export function messageT5Condition(odometerKm: number, distanceKm: number): string {
  return [
    `Записал: ${odometerKm.toLocaleString('ru-RU')} км, пробег ${distanceKm.toLocaleString('ru-RU')} км.`,
    '',
    'Всё в порядке с машиной?',
  ].join('\n');
}

export function messageT5Note(conditionOk: boolean): string {
  return conditionOk
    ? [
        'Есть примечание? Мусор, забытые вещи, повреждения.',
        'Напишите текстом или нажмите «Пропустить».',
      ].join('\n')
    : ['Что с машиной? Напишите коротко — передам в АХО.'].join('\n');
}

export function messageT5Done(hasNote: boolean): string {
  return [
    hasNote ? 'Спасибо, передал в АХО.' : 'Спасибо.',
    'Сдайте ключи на рецепции — поездка закроется, когда их примут.',
  ].join('\n');
}

/** Т5: показание меньше начального. */
export function messageT5TooLow(odometerStartKm: number): string {
  return [
    `Это меньше начального показания (${odometerStartKm.toLocaleString('ru-RU')} км).`,
    '',
    'Проверьте цифры на приборной панели и введите снова.',
  ].join('\n');
}

/** Т6: поездка закрыта. */
export function messageT6(tripId: number, distanceKm: number): string {
  return `Поездка #${tripId} закрыта. Пробег ${distanceKm.toLocaleString('ru-RU')} км.`;
}

export interface DriverTripLine {
  tripId: number;
  startsAt: string;
  endsAt: string;
  route: string;
  carLabel: string | null;
  status: 'ожидает подтверждения' | 'подтверждена' | 'в пути';
}

/** Ответ на кнопку «Мои поездки». */
export function messageMyTrips(trips: DriverTripLine[]): string {
  if (trips.length === 0) {
    return 'Поездок за вами пока нет. Сообщу, как только назначат.';
  }

  const lines = trips.map((trip) =>
    [
      `#${trip.tripId} · ${formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt))}`,
      `${trip.route}`,
      `${trip.carLabel ?? 'машина не указана'} · ${trip.status}`,
    ].join('\n'),
  );

  return ['Ваши поездки:', '', lines.join('\n\n')].join('\n');
}

/** Т3: накануне выезда, 17:00. */
export function messageT3(
  tripId: number,
  route: string,
  departure: string,
  carLabel: string | null,
): string {
  return [
    `Завтра поездка #${tripId} ${route}.`,
    '',
    `Выезд ${departure}.`,
    `Машина: ${carLabel ?? 'не указана'}.`,
    'Ключи у Виктории на рецепции.',
  ].join('\n');
}

/** Т4: поездка изменена, отменена или водитель снят. */
export function messageT4(
  tripId: number,
  route: string,
  what: string,
  needsNewConfirmation: boolean,
): string {
  const lines = [`Поездка #${tripId} ${route}: ${what}.`];

  if (needsNewConfirmation) {
    lines.push('', 'Сейчас пришлю новый запрос подтверждения.');
  }

  return lines.join('\n');
}
