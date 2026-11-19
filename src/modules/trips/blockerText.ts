import { formatDay, formatMoment } from '@/lib/datetime';

import type { Blocker } from './availability';

/**
 * Почему вариант недоступен — словами.
 *
 * Отдельные функции для машины и водителя из-за рода: «занята» и «занят».
 * Склонять в одной функции по флагу — тот случай, когда условие в тексте
 * дороже двух коротких функций.
 */

const REASON: Record<Extract<Blocker, { kind: 'away' }>['reason'], string> = {
  sick: 'болезнь',
  vacation: 'отпуск',
  other: 'другое',
};

export function carBlockerText(blocker: Blocker): string {
  switch (blocker.kind) {
    case 'repair':
      return blocker.note ? `в ремонте: ${blocker.note}` : 'в ремонте';
    case 'busy':
      // Момент освобождения уже с буфером 10 минут: раньше машину не выдадут.
      return `занята до ${formatMoment(new Date(blocker.freeFrom))}`;
    case 'away':
      return 'недоступна';
  }
}

export function driverBlockerText(blocker: Blocker): string {
  switch (blocker.kind) {
    case 'repair':
      return 'недоступен';
    case 'busy':
      return `занят до ${formatMoment(new Date(blocker.freeFrom))}`;
    case 'away':
      return `недоступен (${REASON[blocker.reason]}) до ${formatDay(new Date(blocker.until))}`;
  }
}
