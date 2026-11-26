import 'server-only';

import { URGENT_TRIP_HOURS } from '@/config/app';
import { getDb } from '@/config/supabase';
import { listOpenRemarks } from '@/modules/cars/remarks';
import { listDocumentQueue } from '@/modules/documents/queries';
import { listReceptionDay } from '@/modules/reception/queries';
import { listMyTrips } from '@/modules/trips/queries';
import { tripLabelFrom } from '@/modules/trips/tripLabel';
import { isActiveTrip, tripSections } from '@/modules/trips/tripGroups';

import { attention } from './attention';

import type { AttentionTrip, NavCounts, ReceptionInput } from './attention';
import type { Employee } from '@/modules/employees/queries';
import type { DocumentQueueItem } from '@/modules/documents/queries';
import type { ReceptionTrip } from '@/modules/reception/queries';
import type { TripListItem } from '@/modules/trips/queries';

export type {
  CountedSection,
  NavCounts,
  ReceptionCount,
  SectionCount,
  UrgentRow,
} from './attention';

/**
 * Данные для полоски разделов и блока «Требует внимания».
 *
 * Здесь только сбор: что считать проблемой и какими словами — в `attention.ts`
 * без доступа к базе, чтобы правила проверялись без приложения.
 *
 * Сбой одного счётчика не ломает полоску: каждый считается отдельно, а при
 * ошибке даёт пусто. Лучше без метки, чем без приложения.
 */

async function safely<T>(what: string, value: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await value();
  } catch (error) {
    console.error(`Не удалось посчитать «${what}» для полоски разделов`, error);
    return fallback;
  }
}

function fromReception(trip: ReceptionTrip): AttentionTrip {
  return {
    id: trip.id,
    label: tripLabelFrom(trip.id, trip.startsAt, trip.endsAt),
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    carId: trip.carId,
    status: trip.status,
    needsDriver: trip.needsDriver,
    driverConfirmation: 'unknown',
    docsReady: trip.docsReady,
    docsRecheck: trip.docsRecheckRequired,
    keysIssued: trip.keysIssuedAt !== null,
    odometerEndKm: trip.odometerEndKm,
  };
}

function fromQueue(item: DocumentQueueItem): AttentionTrip {
  return {
    id: item.id,
    label: tripLabelFrom(item.id, item.startsAt, item.endsAt),
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    carId: null,
    status: 'unknown',
    needsDriver: false,
    driverConfirmation: 'unknown',
    // В очереди по определению лежит то, что ещё не готово.
    docsReady: false,
    docsRecheck: item.recheck,
    keysIssued: false,
    odometerEndKm: null,
  };
}

function fromList(trip: TripListItem): AttentionTrip {
  return {
    id: trip.id,
    label: tripLabelFrom(trip.id, trip.startsAt, trip.endsAt),
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    carId: trip.carId,
    status: trip.status,
    needsDriver: trip.needsDriver,
    driverConfirmation: trip.driverConfirmation,
    docsReady: trip.docsReadyAt !== null && !trip.docsRecheckRequired,
    docsRecheck: trip.docsRecheckRequired,
    keysIssued: trip.keysIssuedAt !== null,
    odometerEndKm: trip.odometerEndKm,
  };
}

/**
 * Следующая бронь машин, которые не вернулись.
 *
 * Самая дорогая ситуация во всём приложении: человек приходит за ключами, а
 * машины нет. Знать об этом надо до того, как он придёт, поэтому просрочка
 * сразу называет, чей выезд она ломает.
 */
async function nextBookings(
  carIds: string[],
  now: Date,
): Promise<Map<string, { label: string; startsAt: string }>> {
  const found = new Map<string, { label: string; startsAt: string }>();

  if (carIds.length === 0) {
    return found;
  }

  const { data, error } = await getDb()
    .from('trips')
    .select('id, car_id, route, starts_at, ends_at')
    .in('car_id', carIds)
    .in('status', ['booked', 'docs_ready'])
    .gte('starts_at', now.toISOString())
    .lte('starts_at', new Date(now.getTime() + URGENT_TRIP_HOURS * 3_600_000).toISOString())
    .order('starts_at')
    .returns<{ id: number; car_id: string; route: string; starts_at: string; ends_at: string }[]>();

  if (error) {
    console.error('Не удалось прочитать следующие брони просроченных машин', error);
    return found;
  }

  for (const row of data ?? []) {
    // Запрос отсортирован по времени, поэтому первая найденная — ближайшая.
    if (!found.has(row.car_id)) {
      found.set(row.car_id, {
        label: tripLabelFrom(row.id, row.starts_at, row.ends_at),
        startsAt: row.starts_at,
      });
    }
  }

  return found;
}

/** Машины, которые прямо сейчас не вернулись из поездки. */
async function carsOnTheRoad(carIds: string[], now: Date): Promise<Set<string>> {
  const busy = new Set<string>();

  if (carIds.length === 0) {
    return busy;
  }

  const { data, error } = await getDb()
    .from('trips')
    .select('car_id')
    .in('car_id', carIds)
    .eq('status', 'in_trip')
    .lt('ends_at', now.toISOString())
    .returns<{ car_id: string | null }[]>();

  if (error) {
    console.error('Не удалось проверить, вернулись ли машины', error);
    return busy;
  }

  for (const row of data ?? []) {
    if (row.car_id) {
      busy.add(row.car_id);
    }
  }

  return busy;
}

interface ReceptionLoad {
  input: ReceptionInput;
  carIds: string[];
}

async function loadReception(now: Date): Promise<ReceptionLoad> {
  const day = await listReceptionDay(undefined, now);

  return {
    input: {
      issues: day.issues.map(fromReception),
      returns: day.returns.map(fromReception),
      early: day.early.map(fromReception),
      overdue: day.overdue.map(fromReception),
      stale: day.stale.length,
    },
    carIds: day.overdue.map((trip) => trip.carId).filter((id): id is string => id !== null),
  };
}

interface MineLoad {
  waiting: number[];
  trips: AttentionTrip[];
  carIds: string[];
  /** Все поездки своего списка: по ним проблема показывается в строке. */
  visible: number[];
}

async function loadMine(employee: Employee, now: Date): Promise<MineLoad> {
  const trips = await listMyTrips(employee.id);
  const sections = tripSections(
    trips,
    {
      isAho: employee.roles.includes('aho'),
      isReception: employee.roles.includes('reception'),
      isFinance: employee.roles.includes('finance'),
    },
    now,
  );

  // Проблемы ищем по всем своим действующим поездкам, а не только по тем, где
  // человека ждут по роли: у сотрудника без ролей не ждут нигде, а ехать без
  // документов он всё равно не сможет.
  const mine = trips.filter((trip) => trip.isAuthor && isActiveTrip(trip.status));

  return {
    waiting: sections.waiting,
    visible: trips.map((trip) => trip.id),
    trips: mine.map(fromList),
    // Проверять машину стоит только у поездок, которые ещё не начались.
    carIds: mine
      .filter((trip) => ['booked', 'docs_ready'].includes(trip.status))
      .map((trip) => trip.carId)
      .filter((id): id is string => id !== null),
  };
}

export async function countAttention(employee: Employee, now = new Date()): Promise<NavCounts> {
  const isAho = employee.roles.includes('aho');
  const seesReception = isAho || employee.roles.includes('reception');
  const seesDocuments = isAho || employee.roles.includes('finance');

  const empty: ReceptionLoad = {
    input: { issues: [], returns: [], early: [], overdue: [], stale: 0 },
    carIds: [],
  };

  const [mine, reception, documents, remarks] = await Promise.all([
    safely('мои поездки', () => loadMine(employee, now), {
      waiting: [],
      visible: [],
      trips: [],
      carIds: [],
    }),
    seesReception
      ? safely('рецепция', () => loadReception(now), empty)
      : Promise.resolve(empty),
    seesDocuments
      ? safely('документы', async () => (await listDocumentQueue()).map(fromQueue), [])
      : Promise.resolve([] as AttentionTrip[]),
    isAho ? safely('замечания', async () => (await listOpenRemarks()).length, 0) : Promise.resolve(0),
  ]);

  // Рецепции и АХО про невернувшуюся машину уже сказано строкой просрочки, где
  // названы и машина, и чей выезд она ломает. Автору — только если он не они.
  const [next, stuck] = await Promise.all([
    seesReception
      ? safely('следующие брони', () => nextBookings(reception.carIds, now), new Map())
      : Promise.resolve(new Map<string, { label: string; startsAt: string }>()),
    seesReception
      ? Promise.resolve(new Set<string>())
      : safely('машины в пути', () => carsOnTheRoad(mine.carIds, now), new Set<string>()),
  ]);

  return attention({
    now,
    reception: seesReception ? reception.input : null,
    documents: seesDocuments ? documents : null,
    remarks,
    mineWaiting: mine.waiting,
    mine: mine.trips,
    ownTripIds: new Set(mine.visible),
    nextBookings: next,
    stuckCars: stuck,
  });
}
