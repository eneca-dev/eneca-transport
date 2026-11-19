import type { DriverConfirmation, TripStatus } from './queries';

/**
 * Статусы поездки словами. Тексты взяты из требований: в Э1 человек видит
 * «Документы готовы», «Забронирована», «Закрыта, 548 км».
 */

export const STATUS_LABEL: Record<TripStatus, string> = {
  draft: 'Черновик',
  booked: 'Забронирована',
  docs_ready: 'Документы готовы',
  in_trip: 'В поездке',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

/** Цветовая группа значка. Цвет только дополняет слово, не заменяет его. */
export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad';

export const STATUS_TONE: Record<TripStatus, StatusTone> = {
  draft: 'neutral',
  booked: 'neutral',
  docs_ready: 'ok',
  in_trip: 'warn',
  closed: 'ok',
  cancelled: 'bad',
};

export const CONFIRMATION_LABEL: Record<DriverConfirmation, string> = {
  not_required: 'без водителя',
  pending: 'ожидается подтверждение',
  confirmed: 'подтверждён',
  declined: 'отказался',
  timeout: 'не подтвердил',
};

export const CONFIRMATION_TONE: Record<DriverConfirmation, StatusTone> = {
  not_required: 'neutral',
  pending: 'warn',
  confirmed: 'ok',
  declined: 'bad',
  timeout: 'bad',
};

/** Что в поездке происходит сейчас — для подсказки «что дальше». */
export interface TripProgress {
  status: TripStatus;
  needsDriver: boolean;
  driverConfirmation: DriverConfirmation;
  driverName: string | null;
  docsReadyAt: string | null;
  docsRecheckRequired: boolean;
  keysIssuedAt: string | null;
  distanceKm: number | null;
}

/**
 * Чего поездка ждёт прямо сейчас.
 *
 * Статуса мало: «Забронирована» не говорит, нужно ли что-то делать. Человек
 * должен понимать из одной строки, ждут его или идёт работа без него.
 */
export function whatNext(trip: TripProgress): string | null {
  if (trip.status === 'cancelled') {
    return null;
  }
  if (trip.status === 'closed') {
    return trip.distanceKm !== null ? `пробег ${trip.distanceKm.toLocaleString('ru-RU')} км` : null;
  }
  if (trip.status === 'in_trip') {
    return 'в поездке — одометр и ключи при возврате';
  }

  // Водитель важнее документов: без него поездка может не состояться.
  if (trip.needsDriver) {
    if (trip.driverConfirmation === 'pending') {
      return `ждём подтверждения водителя${trip.driverName ? `: ${trip.driverName}` : ''}`;
    }
    if (trip.driverConfirmation === 'declined') {
      return 'водитель отказался — АХО назначит замену';
    }
    if (trip.driverConfirmation === 'timeout') {
      return 'водитель не подтвердил — АХО назначит замену';
    }
  }

  if (trip.docsRecheckRequired) {
    return 'заявка изменилась — финотдел проверяет документы заново';
  }
  if (trip.keysIssuedAt !== null) {
    return 'ключи у вас — вернуть на рецепцию к плановому времени';
  }
  if (trip.docsReadyAt !== null) {
    return 'документы готовы — забрать их и ключи на рецепции перед выездом';
  }

  return 'финотдел готовит документы';
}

export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-surface-soft text-fg-soft',
  ok: 'bg-ok text-ok-fg',
  warn: 'bg-warn text-warn-fg',
  bad: 'bg-bad text-bad-fg',
};
