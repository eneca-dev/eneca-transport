import { tripState } from './tripStatus';

import type { TripListItem } from './queries';
import type { TripStateView, Viewer } from './tripStatus';

/**
 * Порядок поездок в Э1: сначала то, где ждут тебя.
 *
 * Прежде список шёл по дате выезда вниз, и наверху оказывалась самая далёкая
 * будущая поездка, а та, от которой ждут действия, тонула в середине.
 *
 * Три группы. «Требует внимания» — действующие поездки, где состояние просит
 * что-то сделать именно этого человека. «Текущие и предстоящие» — остальные
 * действующие, по возрастанию выезда: ближайшая первой, просроченная окажется
 * выше всех, потому что её выезд раньше. «Прошедшие» — закрытые и отменённые,
 * по убыванию: последняя сверху.
 *
 * Деление по состоянию заявки, а не по сравнению дат с «сейчас»: поездка,
 * которую не сдали, остаётся действующей, сколько бы времени ни прошло, и
 * уезжать в «прошедшие» ей нельзя.
 *
 * Обращений к базе здесь нет: это арифметика порядка, и ошибку в ней глазами в
 * списке не увидеть.
 */

const ACTIVE = ['booked', 'docs_ready', 'in_trip'];

export type GroupKey = 'attention' | 'current' | 'past';

export interface GroupedTrip {
  trip: TripListItem;
  state: TripStateView;
}

export interface TripGroup {
  key: GroupKey;
  title: string;
  trips: GroupedTrip[];
}

const TITLE: Record<GroupKey, string> = {
  attention: 'Требует внимания',
  current: 'Текущие и предстоящие',
  past: 'Прошедшие',
};

function started(trip: TripListItem): number {
  return new Date(trip.startsAt).getTime();
}

export function groupTrips(
  trips: TripListItem[],
  viewer: Omit<Viewer, 'isAuthor'>,
  now: Date = new Date(),
): TripGroup[] {
  const attention: GroupedTrip[] = [];
  const current: GroupedTrip[] = [];
  const past: GroupedTrip[] = [];

  for (const trip of trips) {
    const state = tripState(trip, { ...viewer, isAuthor: trip.isAuthor }, now);
    const row = { trip, state };

    if (!ACTIVE.includes(trip.status)) {
      past.push(row);
    } else if (state.waitingFor !== null) {
      attention.push(row);
    } else {
      current.push(row);
    }
  }

  attention.sort((a, b) => started(a.trip) - started(b.trip));
  current.sort((a, b) => started(a.trip) - started(b.trip));
  past.sort((a, b) => started(b.trip) - started(a.trip));

  return (
    [
      { key: 'attention' as const, trips: attention },
      { key: 'current' as const, trips: current },
      { key: 'past' as const, trips: past },
    ]
      // Пустая группа не рисуется вовсе: заголовок без строк только отодвигает
      // вниз то, что читают.
      .filter((group) => group.trips.length > 0)
      .map((group) => ({ ...group, title: TITLE[group.key] }))
  );
}
