import 'server-only';

import { getDb } from '@/config/supabase';
import { findEmployeeByOid } from '@/modules/employees/queries';

/**
 * Нажатия на кнопки карточек Teams.
 *
 * Карточку можно переслать, а нажать её может не тот, кому она адресована.
 * Поэтому право на действие проверяется здесь по Entra OID нажавшего, а не по
 * тому, кому карточка отправлена.
 *
 * Требование к состоянию карточки: выполненное действие нельзя выполнить
 * повторно. Отсюда проверка текущего состояния поездки перед каждым действием —
 * и понятный ответ, если действие уже неактуально.
 */

export interface CardActionResult {
  /** Что показать вместо кнопок. */
  message: string;
  /** Нужно ли перерисовать карточку: при отказе оставляем кнопки как были. */
  done: boolean;
}

interface TripRow {
  id: number;
  status: string;
  author_id: string;
  needs_driver: boolean;
  keys_issued_at: string | null;
}

/** «Поеду сам» по К16: назначение водителя снимается, бронь остаётся. */
async function dropDriver(trip: TripRow, employeeId: string): Promise<CardActionResult> {
  if (!trip.needs_driver) {
    return { message: 'Поездка уже без водителя.', done: true };
  }

  const db = getDb();

  const { error } = await db
    .from('trips')
    .update({
      needs_driver: false,
      driver_id: null,
      driver_confirmation: 'not_required',
      driver_assigned_at: null,
      // Состав поездки изменился — финотдел проверяет документы заново.
      docs_recheck_required: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trip.id);

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось снять водителя`, error);
    return { message: 'Не получилось сохранить. Попробуйте ещё раз.', done: false };
  }

  await db.from('trip_events').insert({
    trip_id: trip.id,
    kind: 'driver_dropped',
    payload: { by: 'author_choice' },
    actor_employee: employeeId,
  });

  return {
    message: [
      'Поедете сами, бронь автомобиля сохранена.',
      'Финотдел проверит документы заново — заберите их и ключи на рецепции перед выездом.',
      'Поездка осталась в разделе «Мои поездки».',
    ].join(' '),
    done: true,
  };
}

/** «Отменить поездку» по К16. */
async function cancelTrip(trip: TripRow, employeeId: string): Promise<CardActionResult> {
  if (trip.status === 'cancelled') {
    return { message: 'Поездка уже отменена.', done: true };
  }
  if (trip.keys_issued_at !== null) {
    // Инвариант требований: отмена доступна только до выдачи ключей.
    return { message: 'Ключи уже выданы — отменить поездку нельзя.', done: true };
  }

  const db = getDb();
  const now = new Date().toISOString();

  const { error } = await db
    .from('trips')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: employeeId,
      updated_at: now,
    })
    .eq('id', trip.id);

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось отменить`, error);
    return { message: 'Не получилось отменить. Попробуйте ещё раз.', done: false };
  }

  await db.from('trip_events').insert({
    trip_id: trip.id,
    kind: 'cancelled',
    payload: { by: 'author_choice' },
    actor_employee: employeeId,
  });

  // Триггер базы обнуляет booking_during у отменённой поездки, поэтому машина и
  // водитель освобождаются сами — освобождать их вручную не нужно.
  return {
    message:
      'Поездка отменена, автомобиль освобождён. ' +
      'Она останется в «Моих поездках» со статусом «Отменена».',
    done: true,
  };
}

/**
 * Обработать нажатие. `null` — кнопка не наша или нажавший не имеет права,
 * тогда карточку не трогаем.
 */
export async function handleCardAction(
  entraOid: string,
  value: unknown,
): Promise<CardActionResult | null> {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { action, tripId } = value as { action?: unknown; tripId?: unknown };

  if (typeof action !== 'string' || typeof tripId !== 'number') {
    return null;
  }

  const employee = await findEmployeeByOid(entraOid);

  if (!employee || !employee.isActive) {
    return { message: 'Не удалось определить сотрудника.', done: false };
  }

  const { data: trip, error } = await getDb()
    .from('trips')
    .select('id, status, author_id, needs_driver, keys_issued_at')
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    return { message: 'Поездка не найдена.', done: true };
  }

  // Решение по К16 принимает автор. АХО допускается: по требованиям она ведёт
  // брони и может решать за автора, если тот недоступен.
  const allowed = trip.author_id === employee.id || employee.roles.includes('aho');

  if (!allowed) {
    return { message: 'Это решение принимает автор поездки.', done: false };
  }

  switch (action) {
    case 'trip_without_driver':
      return dropDriver(trip, employee.id);
    case 'trip_cancel':
      return cancelTrip(trip, employee.id);
    default:
      return null;
  }
}
