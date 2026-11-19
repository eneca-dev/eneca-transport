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
