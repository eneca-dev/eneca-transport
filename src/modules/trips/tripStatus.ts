import type { DriverConfirmation, TripStatus } from './queries';

/**
 * Состояние поездки одной фразой.
 *
 * Раньше в списке стояла метка статуса из базы, а под ней отдельная строка
 * «что дальше», и они противоречили друг другу: поездка со вчерашним возвратом
 * называлась «В поездке», а заявка с отказавшимся водителем — «Документы
 * готовы».
 *
 * Причина была в том, что статус поездки, состояние водителя, готовность
 * документов и время — четыре независимых факта, а метка показывала только
 * первый. Здесь они сводятся в одно состояние, и порядок проверок важен:
 * сначала то, что требует вмешательства.
 */

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'active';

export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-surface-soft text-fg-soft',
  ok: 'bg-ok text-ok-fg',
  warn: 'bg-warn text-warn-fg',
  bad: 'bg-bad text-bad-fg',
  active: 'bg-brand text-brand-fg',
};

/** Факты, из которых складывается состояние. */
export interface TripFacts {
  status: TripStatus;
  needsDriver: boolean;
  driverConfirmation: DriverConfirmation;
  driverName: string | null;
  docsReadyAt: string | null;
  docsRecheckRequired: boolean;
  keysIssuedAt: string | null;
  odometerEndKm: number | null;
  distanceKm: number | null;
  startsAt: string;
  endsAt: string;
}

/** Кто смотрит. От этого зависит только строка «от вас ждут». */
export interface Viewer {
  isAuthor: boolean;
  isAho: boolean;
  isReception: boolean;
  isFinance: boolean;
}

export interface TripStateView {
  label: string;
  tone: StatusTone;
  /** Что требуется от смотрящего. `null` — ждут не его. */
  waitingFor: string | null;
}

const NOBODY: Viewer = {
  isAuthor: false,
  isAho: false,
  isReception: false,
  isFinance: false,
};

/**
 * Состояние поездки и, если смотрящий участвует, что требуется от него.
 *
 * `now` передаётся явно: состояние зависит от времени, и без этого его не
 * проверить.
 */
export function tripState(
  trip: TripFacts,
  viewer: Viewer = NOBODY,
  now: Date = new Date(),
): TripStateView {
  const moment = now.getTime();
  const overdue = new Date(trip.endsAt).getTime() < moment;
  const departed = new Date(trip.startsAt).getTime() <= moment;

  if (trip.status === 'cancelled') {
    return { label: 'Отменена', tone: 'neutral', waitingFor: null };
  }

  if (trip.status === 'closed') {
    const distance =
      trip.distanceKm !== null ? ` · ${trip.distanceKm.toLocaleString('ru-RU')} км` : '';
    return { label: `Закрыта${distance}`, tone: 'ok', waitingFor: null };
  }

  if (trip.status === 'in_trip') {
    // Показание передано — остался только приём ключей.
    if (trip.odometerEndKm !== null) {
      return {
        label: overdue ? 'Просрочен возврат, ждём приём ключей' : 'Ждём приём ключей',
        tone: overdue ? 'bad' : 'warn',
        waitingFor: viewer.isReception || viewer.isAho ? 'принять ключи' : null,
      };
    }

    const needOdometer =
      !trip.needsDriver && viewer.isAuthor ? 'показание одометра' : null;

    if (overdue) {
      return {
        label: 'Просрочен возврат',
        tone: 'bad',
        waitingFor: needOdometer ?? (viewer.isAho ? 'выяснить, где машина' : null),
      };
    }

    return { label: 'В поездке', tone: 'active', waitingFor: needOdometer };
  }

  // Дальше поездка ещё не выехала: booked или docs_ready.

  if (trip.needsDriver) {
    if (trip.driverConfirmation === 'declined') {
      return {
        label: 'Нужен другой водитель',
        tone: 'bad',
        waitingFor: viewer.isAho
          ? 'назначить водителя: прежний отказался'
          : viewer.isAuthor
            ? 'решить: ехать самому или отменить'
            : null,
      };
    }

    /**
     * Молчание отделено от отказа намеренно.
     *
     * Отказ окончателен — нужен другой водитель. Молчание чаще всего значит,
     * что водитель за рулём: он ещё может подтвердить сам, а АХО — подтвердить
     * за него после звонка. Называть это «нужен другой водитель» значит
     * толкать к замене там, где достаточно позвонить.
     */
    if (trip.driverConfirmation === 'timeout') {
      const who = trip.driverName ? `: ${trip.driverName}` : '';
      return {
        label: `Нет ответа от водителя${who}`,
        tone: 'bad',
        // Автора здесь ни о чём не просят: вопрос решает АХО, а если к выезду
        // он не решён — автору приходит К16 с выбором.
        waitingFor: viewer.isAho
          ? 'позвонить водителю — подтвердить за него или назначить другого'
          : null,
      };
    }

    if (trip.driverConfirmation === 'pending') {
      const who = trip.driverName ? `: ${trip.driverName}` : '';
      return {
        label: `Ждём подтверждения водителя${who}`,
        tone: 'warn',
        waitingFor: null,
      };
    }
  }

  if (trip.docsRecheckRequired) {
    return {
      label: 'Документы проверяют заново',
      tone: 'warn',
      waitingFor: viewer.isFinance || viewer.isAho ? 'проверить документы' : null,
    };
  }

  if (trip.docsReadyAt === null) {
    return {
      label: 'Готовят документы',
      tone: 'warn',
      waitingFor: viewer.isFinance || viewer.isAho ? 'подтвердить готовность' : null,
    };
  }

  if (trip.keysIssuedAt === null && departed) {
    return {
      label: 'Пора выезжать, ключи на рецепции',
      tone: 'active',
      waitingFor: viewer.isReception || viewer.isAho ? 'выдать ключи' : null,
    };
  }

  return { label: 'Готова к выезду', tone: 'ok', waitingFor: null };
}

/**
 * Что произойдёт следующим шагом и от кого это зависит.
 *
 * Состояние отвечает на вопрос «что сейчас», а этого мало: человек хочет
 * знать, чего ждать и когда беспокоиться. Без такой строки половина вопросов к
 * АХО — «а что дальше-то?».
 *
 * Пишется от третьего лица, кроме шагов самого смотрящего: «финотдел готовит
 * документы», но «заберите ключи». `null` — дальше ничего не будет: поездка
 * закрыта или отменена.
 */
export function nextStep(
  trip: TripFacts,
  viewer: Viewer = NOBODY,
  now: Date = new Date(),
): string | null {
  if (trip.status === 'cancelled' || trip.status === 'closed') {
    return null;
  }

  if (trip.status === 'in_trip') {
    if (trip.odometerEndKm !== null) {
      return 'рецепция принимает ключи — после этого поездка закроется';
    }
    if (!trip.needsDriver) {
      return viewer.isAuthor
        ? 'при возврате передайте показание одометра'
        : 'автор передаёт показание одометра при возврате';
    }
    return 'водитель передаёт показание одометра при возврате';
  }

  if (trip.needsDriver) {
    if (trip.driverConfirmation === 'declined') {
      return 'АХО назначает другого водителя';
    }
    if (trip.driverConfirmation === 'timeout') {
      return 'АХО связывается с водителем';
    }
    if (trip.driverConfirmation === 'pending') {
      return 'водитель подтверждает поездку';
    }
  }

  if (trip.docsRecheckRequired) {
    return 'финотдел проверяет документы заново';
  }

  if (trip.docsReadyAt === null) {
    return 'финотдел готовит документы';
  }

  if (trip.keysIssuedAt === null) {
    const departed = new Date(trip.startsAt).getTime() <= now.getTime();
    const where = viewer.isAuthor ? 'заберите документы и ключи на рецепции' : 'выдача ключей на рецепции';
    return departed ? `${where} — время выезда наступило` : where;
  }

  return null;
}

/**
 * Подтверждение водителя отдельной меткой в карточке поездки.
 *
 * В списке оно уже входит в состояние, а в Э3 показывается рядом с именем
 * водителя: там видно и кого назначили, и ответил ли он.
 */
export const CONFIRMATION_LABEL: Record<DriverConfirmation, string> = {
  not_required: 'без водителя',
  pending: 'ожидается подтверждение',
  confirmed: 'подтверждён',
  declined: 'отказался',
  timeout: 'не ответил',
};

export const CONFIRMATION_TONE: Record<DriverConfirmation, StatusTone> = {
  not_required: 'neutral',
  pending: 'warn',
  confirmed: 'ok',
  declined: 'bad',
  timeout: 'bad',
};
