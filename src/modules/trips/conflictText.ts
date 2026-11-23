import { formatPeriod } from '@/lib/datetime';

/**
 * Как назвать человеку бронь, которая мешает закрыть просроченную поездку.
 *
 * Без доступа к базе намеренно: формулировки читают и рецепция в Э5, и тот,
 * кто нажал «Принять» и получил отказ. Текст один, проверить его можно без
 * приложения — так же, как арифметику броней в `booking.ts`.
 */

export interface ConflictingTrip {
  id: number;
  startsAt: string;
  endsAt: string;
  /** Чем именно занято: та же машина или тот же водитель. */
  kind: 'car' | 'driver';
}

/** Сколько заявок называем по номерам, прежде чем перейти к «и ещё N». */
const LISTED = 3;

/** «#100 (23.11 10:00 – 23.11 20:00, машина)» — перечень через запятую. */
export function conflictList(conflicts: ConflictingTrip[]): string {
  const listed = conflicts
    .slice(0, LISTED)
    .map((item) => {
      const what = item.kind === 'car' ? 'машина' : 'водитель';
      const when = formatPeriod(new Date(item.startsAt), new Date(item.endsAt));

      return `#${item.id} (${when}, ${what})`;
    })
    .join(', ');

  return conflicts.length > LISTED ? `${listed} и ещё ${conflicts.length - LISTED}` : listed;
}

/** Полная причина отказа — её видно после нажатия «Принять». */
export function lateReturnReason(conflicts: ConflictingTrip[]): string {
  const head =
    'Машина вернулась позже планового времени, и по требованиям она считается ' +
    'занятой до момента, когда её сдали. Этот интервал наложился на другую бронь.';

  if (conflicts.length === 0) {
    return `${head} Найдите её в календаре, перенесите или отмените — затем примите ключи.`;
  }

  return `${head} Мешает ${conflictList(conflicts)}. Перенесите или отмените — затем примите ключи.`;
}
