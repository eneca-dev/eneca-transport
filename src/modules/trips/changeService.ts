import 'server-only';

import { getDb } from '@/config/supabase';
import { formatPeriod } from '@/lib/datetime';
import { notifyFinanceNewRequest } from '@/modules/documents/notify';

import {
  notifyDriverAssigned,
  notifyDriverConfirmedByAho,
  notifyDriverUnassigned,
} from './notifyDriver';
import { notifyTripChanged } from './notifyChange';

/**
 * Перенос и отмена заявки.
 *
 * Оба действия доступны только до выдачи ключей — это инвариант требований.
 * После выдачи поездка идёт своим ходом: отменять выданную машину бессмысленно,
 * её нужно принять.
 *
 * Непересечение броней держит база. Здесь только перевод её отказа в текст:
 * между выбором новых дат и записью машину может занять кто-то другой.
 */

export type ChangeOutcome = { ok: true } | { ok: false; reason: string };

interface TripRow {
  id: number;
  status: string;
  author_id: string;
  starts_at: string;
  ends_at: string;
  needs_driver: boolean;
  car_id: string | null;
  driver_id: string | null;
  driver_confirmation: string;
  keys_issued_at: string | null;
}

const SELECT =
  'id, status, author_id, starts_at, ends_at, needs_driver, car_id, driver_id, ' +
  'driver_confirmation, keys_issued_at';

async function loadTrip(tripId: number): Promise<TripRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error) {
    throw new Error(`Не удалось прочитать поездку #${tripId}: ${error.message}`);
  }
  return data;
}

/** Общая проверка: менять заявку можно, пока ключи не выданы. */
function guard(trip: TripRow | null): ChangeOutcome {
  if (!trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }
  if (trip.status === 'cancelled') {
    return { ok: false, reason: 'Поездка уже отменена.' };
  }
  if (trip.keys_issued_at !== null || !['booked', 'docs_ready'].includes(trip.status)) {
    return { ok: false, reason: 'Ключи уже выданы — перенести или отменить нельзя.' };
  }
  return { ok: true };
}

/** Отменить заявку. Машину и водителя освобождает триггер базы. */
export async function cancelTrip(tripId: number, employeeId: string): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok) {
    return allowed;
  }

  const db = getDb();
  const now = new Date().toISOString();

  const { data: updated, error } = await db
    .from('trips')
    .update({ status: 'cancelled', cancelled_at: now, cancelled_by: employeeId, updated_at: now })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось отменить`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }
  if ((updated ?? []).length === 0) {
    return { ok: false, reason: 'Поездка только что изменилась. Обновите экран.' };
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'cancelled',
    payload: {},
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'cancelled',
    'Поездка отменена, автомобиль и водитель свободны',
    'cancelled',
  );

  return { ok: true };
}

export interface RescheduleInput {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Перенести заявку на другое время.
 *
 * Если у поездки есть водитель, перенос сбрасывает его подтверждение: по
 * требованиям изменение времени требует нового подтверждения за 15 минут.
 * Документы уходят на повторную проверку — прежний комплект выписан на старые
 * даты.
 */
export async function rescheduleTrip(
  tripId: number,
  employeeId: string,
  input: RescheduleInput,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }

  if (input.endsAt <= input.startsAt) {
    return { ok: false, reason: 'Возврат должен быть позже выезда.' };
  }
  if (input.endsAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'Новое время уже прошло. Проверьте даты.' };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const hasDriver = trip.needs_driver && trip.driver_id !== null;

  const { data: updated, error } = await db
    .from('trips')
    .update({
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      // Прежний комплект документов выписан на старые даты.
      docs_recheck_required: true,
      // Новое время — новое подтверждение, отсчёт 15 минут начинается заново.
      ...(hasDriver
        ? { driver_confirmation: 'pending', driver_assigned_at: now }
        : {}),
      updated_at: now,
    })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    // 23P01 — ограничение непересечения: новые даты заняты.
    if (error.code === '23P01') {
      const reason = error.message.includes('trips_driver_no_overlap')
        ? 'На это время водитель занят другой поездкой. Выберите другое время.'
        : 'На это время машина занята. Выберите другое время или другую машину.';
      return { ok: false, reason };
    }
    console.error(`Поездка #${tripId}: не удалось перенести`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  if ((updated ?? []).length === 0) {
    return { ok: false, reason: 'Поездка только что изменилась. Обновите экран.' };
  }

  const was = formatPeriod(new Date(trip.starts_at), new Date(trip.ends_at));
  const became = formatPeriod(input.startsAt, input.endsAt);

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'rescheduled',
    payload: { was, became },
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'rescheduled',
    `Время: было ${was}, стало ${became}`,
    // В ключ входит новое время: два переноса подряд — два сообщения.
    `rescheduled:${input.startsAt.toISOString()}`,
    hasDriver,
  );

  // Новый запрос подтверждения водителю и повторная проверка документов.
  if (hasDriver) {
    await notifyDriverAssigned(tripId);
  }
  await notifyFinanceNewRequest(tripId, 'recheck');

  return { ok: true };
}

export interface AssignResult {
  previousDriver: string | null;
  newDriver: string;
}

/**
 * Назначить водителя — или заменить прежнего.
 *
 * По требованиям замена даёт новый Т1 и новые 15 минут, а прежнему водителю
 * уходит Т4 «вы сняты с поездки». Документы идут на повторную проверку: в них
 * указан водитель.
 */
export async function assignDriver(
  tripId: number,
  employeeId: string,
  driverId: string,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }

  if (trip.driver_id === driverId) {
    return { ok: false, reason: 'Этот водитель уже назначен на поездку.' };
  }

  const db = getDb();
  const now = new Date().toISOString();

  const previous = await driverName(trip.driver_id);
  const next = await driverName(driverId);

  if (!next) {
    return { ok: false, reason: 'Водитель не найден.' };
  }

  const { error } = await db
    .from('trips')
    .update({
      needs_driver: true,
      driver_id: driverId,
      driver_confirmation: 'pending',
      driver_assigned_at: now,
      docs_recheck_required: true,
      updated_at: now,
    })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready']);

  if (error) {
    // 23P01 — водитель занят другой поездкой на это же время.
    if (error.code === '23P01') {
      return { ok: false, reason: 'Этот водитель занят другой поездкой на это время.' };
    }
    console.error(`Поездка #${tripId}: не удалось назначить водителя`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'driver_assigned',
    payload: { previous, next },
    actor_employee: employeeId,
  });

  // Прежнему водителю — Т4, новому — Т1. Порядок важен: сначала снятый должен
  // узнать, что ехать не нужно.
  if (trip.driver_id) {
    await notifyDriverUnassigned(tripId, trip.driver_id);
  }

  await notifyTripChanged(
    tripId,
    'driver_changed',
    previous ? `Водитель: ${previous} → ${next}` : `Назначен водитель: ${next}`,
    `driver:${driverId}:${now}`,
    true,
  );

  await notifyDriverAssigned(tripId);
  await notifyFinanceNewRequest(tripId, 'recheck');

  return { ok: true };
}

/**
 * Подтвердить за водителя.
 *
 * Водитель нередко отвечает голосом по телефону и в бот не заходит. В журнале
 * при этом пишется, что подтвердила АХО, а не водитель: иначе через месяц
 * непонятно, кто на самом деле согласился.
 */
export async function confirmForDriver(
  tripId: number,
  employeeId: string,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }
  if (!trip.needs_driver || !trip.driver_id) {
    return { ok: false, reason: 'На поездке нет водителя.' };
  }
  if (trip.driver_confirmation === 'confirmed') {
    return { ok: false, reason: 'Поездка уже подтверждена.' };
  }

  const db = getDb();
  const now = new Date().toISOString();

  const { error } = await db
    .from('trips')
    .update({ driver_confirmation: 'confirmed', updated_at: now })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready']);

  if (error) {
    console.error(`Поездка #${tripId}: не удалось подтвердить за водителя`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'driver_confirmed_by_aho',
    payload: { driver: await driverName(trip.driver_id) },
    actor_employee: employeeId,
  });

  // Водитель должен узнать, что поездка закреплена за ним: договорённость по
  // телефону в боте не видна, а готовиться к выезду ему.
  await notifyDriverConfirmedByAho(tripId);

  return { ok: true };
}

async function driverName(driverId: string | null): Promise<string | null> {
  if (!driverId) {
    return null;
  }

  const { data } = await getDb()
    .from('drivers')
    .select('full_name')
    .eq('id', driverId)
    .maybeSingle<{ full_name: string }>();

  return data?.full_name ?? null;
}

export interface EditInput {
  route: string;
  contract: string;
  purpose: string;
  participantIds: string[];
}

/** Одно изменённое поле — для журнала и для перечня в К12 и Э5. */
export interface FieldChange {
  field: string;
  was: string;
  became: string;
}

/**
 * Правка заявки: маршрут, договор, цель, участники.
 *
 * Водитель и машина меняются отдельными действиями: у них своя проверка
 * занятости, а у водителя ещё и подтверждение. «Нужен водитель» здесь тоже
 * не меняется — ограничение базы не даёт включить его без выбранного
 * водителя, поэтому это делает «Назначить водителя».
 */
export async function editTrip(
  tripId: number,
  employeeId: string,
  input: EditInput,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }

  const db = getDb();

  const { data: current, error: currentError } = await db
    .from('trips')
    .select('route, contract, purpose')
    .eq('id', tripId)
    .maybeSingle<{ route: string; contract: string; purpose: string }>();

  if (currentError || !current) {
    return { ok: false, reason: 'Не удалось прочитать заявку.' };
  }

  const { data: participants, error: participantsError } = await db
    .from('trip_participants')
    .select('employee_id, employees(display_name)')
    .eq('trip_id', tripId)
    .returns<{ employee_id: string; employees: { display_name: string } | null }[]>();

  if (participantsError) {
    return { ok: false, reason: 'Не удалось прочитать участников.' };
  }

  const wasIds = new Set((participants ?? []).map((row) => row.employee_id));
  const becameIds = new Set(input.participantIds.filter((id) => id !== trip.author_id));

  const changes: FieldChange[] = [];

  if (current.route !== input.route) {
    changes.push({ field: 'Маршрут', was: current.route, became: input.route });
  }
  if (current.contract !== input.contract) {
    changes.push({ field: 'Договор', was: current.contract, became: input.contract });
  }
  if (current.purpose !== input.purpose) {
    changes.push({ field: 'Цель', was: current.purpose, became: input.purpose });
  }

  const participantsChanged =
    wasIds.size !== becameIds.size || [...wasIds].some((id) => !becameIds.has(id));

  if (participantsChanged) {
    const wasNames = (participants ?? [])
      .map((row) => row.employees?.display_name ?? '—')
      .join(', ');

    // Имена новых участников читаем сразу: в журнале должно стоять, кто стал
    // ездить, а не «новый список» — иначе финотделу всё равно придётся
    // открывать заявку.
    const { data: becameRows } = await db
      .from('employees')
      .select('display_name')
      .in('id', [...becameIds])
      .order('display_name')
      .returns<{ display_name: string }[]>();

    const becameNames = (becameRows ?? []).map((row) => row.display_name).join(', ');

    changes.push({
      field: 'Участники',
      was: wasNames || 'только автор',
      became: becameNames || 'только автор',
    });
  }

  if (changes.length === 0) {
    return { ok: false, reason: 'Ничего не изменилось.' };
  }

  const now = new Date().toISOString();

  const { data: updated, error } = await db
    .from('trips')
    .update({
      route: input.route,
      contract: input.contract,
      purpose: input.purpose,
      // Документы выписаны на прежние данные.
      docs_recheck_required: true,
      updated_at: now,
    })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось сохранить правку`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }
  if ((updated ?? []).length === 0) {
    return { ok: false, reason: 'Поездка только что изменилась. Обновите экран.' };
  }

  if (participantsChanged) {
    await db.from('trip_participants').delete().eq('trip_id', tripId);

    if (becameIds.size > 0) {
      const { error: insertError } = await db
        .from('trip_participants')
        .insert([...becameIds].map((id) => ({ trip_id: tripId, employee_id: id })));

      if (insertError) {
        console.error(`Поездка #${tripId}: не удалось записать участников`, insertError);
      }
    }
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'trip_edited',
    payload: { changes },
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'data_changed',
    changes.map((change) => `${change.field}: было «${change.was}»`).join('; '),
    `edited:${now}`,
  );

  await notifyFinanceNewRequest(tripId, 'recheck');

  return { ok: true };
}

/**
 * Смена машины.
 *
 * Нужна в первую очередь по К13: когда машину забрали в ремонт, человек должен
 * выбрать другую, а не отменять поездку.
 */
export async function changeCar(
  tripId: number,
  employeeId: string,
  carId: string,
): Promise<ChangeOutcome> {
  const trip = await loadTrip(tripId);
  const allowed = guard(trip);

  if (!allowed.ok || !trip) {
    return allowed.ok ? { ok: false, reason: 'Поездка не найдена.' } : allowed;
  }

  const db = getDb();

  const previous = await carLabel(trip.car_id);
  const next = await carLabel(carId);

  if (!next) {
    return { ok: false, reason: 'Машина не найдена.' };
  }
  if (trip.car_id === carId) {
    return { ok: false, reason: 'Эта машина уже выбрана.' };
  }

  const now = new Date().toISOString();

  const { error } = await db
    .from('trips')
    .update({ car_id: carId, docs_recheck_required: true, updated_at: now })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready']);

  if (error) {
    if (error.code === '23P01') {
      return { ok: false, reason: 'Эта машина занята на время поездки. Выберите другую.' };
    }
    console.error(`Поездка #${tripId}: не удалось сменить машину`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'car_changed',
    payload: { previous, next },
    actor_employee: employeeId,
  });

  await notifyTripChanged(
    tripId,
    'data_changed',
    previous ? `Машина: ${previous} → ${next}` : `Выбрана машина: ${next}`,
    `car:${carId}:${now}`,
  );

  await notifyFinanceNewRequest(tripId, 'recheck');

  return { ok: true };
}

async function carLabel(carId: string | null): Promise<string | null> {
  if (!carId) {
    return null;
  }

  const { data } = await getDb()
    .from('cars')
    .select('plate, model')
    .eq('id', carId)
    .maybeSingle<{ plate: string; model: string }>();

  return data ? `${data.model} ${data.plate}` : null;
}
