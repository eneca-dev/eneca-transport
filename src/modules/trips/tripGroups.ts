import { tripState } from './tripStatus';

import type { TripListItem } from './queries';
import type { TripStateView, Viewer } from './tripStatus';

/**
 * Порядок поездок в Э1: действующие одним списком по дате, прошедшие отдельно.
 *
 * Прежде список шёл по дате выезда вниз, и наверху оказывалась самая далёкая
 * будущая поездка. Потом действующие делились на «Требует внимания» и
 * «Текущие», но это деление дублировало строку «От вас» под поездкой и ломало
 * порядок по датам, которым человек планирует: поездка на следующей неделе
 * оказывалась выше завтрашней. Важное показывается красными строками наверху
 * экрана, а список остаётся списком.
 *
 * Деление на действующие и прошедшие — по состоянию заявки, а не по сравнению
 * дат с «сейчас»: поездка, которую не сдали, остаётся действующей, сколько бы
 * времени ни прошло, и уезжать в «прошедшие» ей нельзя.
 *
 * Обращений к базе здесь нет: это арифметика порядка, и ошибку в ней глазами
 * в списке не увидеть.
 */

const ACTIVE = ['booked', 'docs_ready', 'in_trip'];

export interface GroupedTrip {
  trip: TripListItem;
  state: TripStateView;
}

export interface TripSections {
  /** Действующие: по возрастанию выезда, ближайшая первой. */
  current: GroupedTrip[];
  /** Закрытые и отменённые: по убыванию, последняя сверху. */
  past: GroupedTrip[];
  /**
   * Номера действующих поездок, где ждут смотрящего.
   *
   * Нужны числу у раздела «Мои поездки» и строке «От вас» в списке. Именно
   * номера, а не количество: то же число складывается с поездками, у которых
   * есть проблема, и считать их дважды нельзя.
   */
  waiting: number[];
}

function started(trip: TripListItem): number {
  return new Date(trip.startsAt).getTime();
}

export function isActiveTrip(status: string): boolean {
  return ACTIVE.includes(status);
}

export function tripSections(
  trips: TripListItem[],
  viewer: Omit<Viewer, 'isAuthor'>,
  now: Date = new Date(),
): TripSections {
  const current: GroupedTrip[] = [];
  const past: GroupedTrip[] = [];
  const waiting: number[] = [];

  for (const trip of trips) {
    const state = tripState(trip, { ...viewer, isAuthor: trip.isAuthor }, now);
    const row = { trip, state };

    if (isActiveTrip(trip.status)) {
      current.push(row);
      if (state.waitingFor !== null) {
        waiting.push(trip.id);
      }
    } else {
      past.push(row);
    }
  }

  current.sort((a, b) => started(a.trip) - started(b.trip));
  past.sort((a, b) => started(b.trip) - started(a.trip));

  return { current, past, waiting };
}
