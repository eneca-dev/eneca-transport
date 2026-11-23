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
  /** Автор заявки: за поездку отвечает он, и водителю это нужно знать. */
  responsible: string;
  /** Участники без автора. */
  passengers: string[];
  contract: string;
  purpose: string;
}

/**
 * Т1: водителя назначили на поездку.
 *
 * Договор и цель здесь не для порядка: на объекте водителя спрашивают, по
 * какому договору приехали. Ответственного он должен знать, чтобы было к кому
 * обратиться на месте.
 */
export function messageT1(trip: AssignmentMessage): string {
  const lines = [
    `Поездка #${trip.tripId}`,
    formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt)),
    trip.route,
    '',
    `Машина: ${trip.carLabel ?? 'не указана'}`,
    `Ответственный: ${trip.responsible}`,
  ];

  if (trip.passengers.length > 0) {
    lines.push(`Пассажиры: ${trip.passengers.join(', ')}`);
  }

  lines.push(`Договор: ${trip.contract}`, `Цель: ${trip.purpose}`);
  lines.push('', `Подтвердите, пожалуйста, в течение ${DRIVER_CONFIRMATION_MINUTES} минут.`);

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
  responsible: string | null = null,
): string {
  const lines = [`Поездка #${tripId} ${route}. Время возврата.`];

  if (responsible) {
    lines.push(`Ответственный: ${responsible}.`);
  }

  lines.push(
    '',
    'Введите показание одометра.',
    `Начальное — ${odometerStartKm.toLocaleString('ru-RU')} км.`,
  );

  return lines.join('\n');
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
  status:
    | 'ожидает подтверждения'
    | 'подтверждение просрочено'
    | 'вы отказались'
    | 'подтверждена'
    | 'в пути'
    | 'закрыта';
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

export interface DriverDayTrip extends DriverTripLine {
  /** Автор заявки: водителю нужно знать, к кому обращаться на месте. */
  responsible: string | null;
}

/**
 * Календарь водителя: подпись над сеткой месяца.
 *
 * Счётчик написан как «Поездок: 3», а не «3 поездки»: так не нужно
 * согласовывать окончание, и при одной поездке строка не выглядит ошибкой.
 */
export function messageDriverMonth(monthLabel: string, tripCount: number): string {
  if (tripCount === 0) {
    return [
      `Ваш график на ${monthLabel}.`,
      '',
      'В этом месяце за вами поездок нет. Стрелками можно посмотреть другие месяцы.',
    ].join('\n');
  }

  return [
    `Ваш график на ${monthLabel}.`,
    `Поездок: ${tripCount}.`,
    '',
    'Дни с поездками — в квадратных скобках. Нажмите день, чтобы посмотреть.',
  ].join('\n');
}

/** Календарь водителя: один день. */
export function messageDriverDay(dayLabel: string, trips: DriverDayTrip[]): string {
  if (trips.length === 0) {
    return `${dayLabel} — поездок нет.`;
  }

  const blocks = trips.map((trip) => {
    const lines = [
      `#${trip.tripId} · ${formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt))}`,
      trip.route,
      `${trip.carLabel ?? 'машина не указана'} · ${trip.status}`,
    ];

    if (trip.responsible) {
      lines.push(`Ответственный: ${trip.responsible}`);
    }

    return lines.join('\n');
  });

  return [dayLabel, '', blocks.join('\n\n')].join('\n');
}

/** Нажали день без поездок: всплывающая подсказка, сообщение не меняется. */
export function messageDriverFreeDay(dayLabel: string): string {
  return `${dayLabel} — поездок нет.`;
}

/** Т3: накануне выезда, 17:00. */
export function messageT3(
  tripId: number,
  route: string,
  departure: string,
  carLabel: string | null,
  responsible: string | null = null,
): string {
  const lines = [`Завтра поездка #${tripId} ${route}.`, '', `Выезд ${departure}.`];

  lines.push(`Машина: ${carLabel ?? 'не указана'}.`);

  if (responsible) {
    lines.push(`Ответственный: ${responsible}.`);
  }

  lines.push('Ключи у Виктории на рецепции.');

  return lines.join('\n');
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
