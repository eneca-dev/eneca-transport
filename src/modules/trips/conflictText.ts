import { formatPeriod, formatTime } from '@/lib/datetime';

/**
 * Формулировки о том, почему машину нельзя принять или выдать прямо сейчас.
 *
 * Без доступа к базе намеренно: текст читают и рецепция на экране, и тот, кто
 * нажал кнопку и получил отказ. Проверить его можно без приложения — так же,
 * как арифметику броней в `booking.ts`.
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

      return `№${item.id} (${when}, ${what})`;
    })
    .join(', ');

  return conflicts.length > LISTED ? `${listed} и ещё ${conflicts.length - LISTED}` : listed;
}

/** Полная причина отказа — её видно после нажатия «Принять». */
/** Машину только что приняли, и десять минут ещё не прошли. */
export interface TooSoon {
  /** Поездка, по которой машину сдали. */
  tripId: number;
  returnedAt: string;
  /** Когда её можно выдавать. */
  freeFrom: string;
}

/**
 * Почему следующую выдачу нельзя оформить прямо сейчас.
 *
 * Требование: «следующая бронь — не раньше чем через 10 минут после
 * фактического возврата». Десять минут не формальность: рецепция принимает
 * ключи, осматривает машину и выдаёт документы следующему.
 *
 * Время без даты: отказ возможен только в пределах этих десяти минут, значит
 * и сдача, и выдача приходятся на один день.
 */
export function issueTooSoonReason(info: TooSoon): string {
  return (
    `Машину приняли по поездке №${info.tripId} в ${formatTime(new Date(info.returnedAt))}. ` +
    `Выдать её можно с ${formatTime(new Date(info.freeFrom))} — ` +
    'десять минут на приём и осмотр.'
  );
}

export function lateReturnReason(conflicts: ConflictingTrip[]): string {
  const head =
    'Машина вернулась позже планового времени, и по требованиям она считается ' +
    'занятой до момента, когда её сдали. Этот интервал наложился на другую бронь.';

  if (conflicts.length === 0) {
    return `${head} Найдите её в календаре, перенесите или отмените — затем примите ключи.`;
  }

  return `${head} Мешает ${conflictList(conflicts)}. Перенесите или отмените — затем примите ключи.`;
}
