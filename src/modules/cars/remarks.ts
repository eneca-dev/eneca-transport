import 'server-only';

import { getDb } from '@/config/supabase';

/**
 * Замечания и примечания из возвратов — для Э8.
 *
 * Разница в смысле. Примечание (забытые вещи, мусор) достаточно принять к
 * сведению. Замечание по машине требует решения: в ремонт или ничего
 * страшного. Поэтому у них разные кнопки.
 *
 * Обработанные не хранятся отдельным полем: отметка пишется событием в журнал
 * поездки. Так видно, кто и когда закрыл замечание, и Э3 показывает это в
 * общей истории.
 */

/** Виды событий, которыми закрывается замечание. */
export const HANDLED_EVENTS = ['remark_handled', 'remark_to_repair'] as const;

export interface CarRemark {
  tripId: number;
  carId: string;
  /** true — замечание по машине, false — примечание о поездке. */
  isRemark: boolean;
  text: string;
  /** Когда оформлен возврат, в котором это написали. */
  at: string;
  author: string;
}

interface TripRow {
  id: number;
  car_id: string | null;
  condition_ok: boolean | null;
  return_note: string | null;
  keys_returned_at: string | null;
  updated_at: string;
  drivers: { full_name: string } | null;
  employees: { display_name: string } | null;
}

interface EventRow {
  trip_id: number;
}

/**
 * Необработанные замечания и примечания по всем машинам.
 *
 * Берутся поездки, где возврат уже оформлен: до него писать замечание неоткуда.
 */
export async function listOpenRemarks(): Promise<CarRemark[]> {
  const db = getDb();

  const { data: trips, error } = await db
    .from('trips')
    .select(
      'id, car_id, condition_ok, return_note, keys_returned_at, updated_at, ' +
        'drivers(full_name), employees!trips_author_id_fkey(display_name)',
    )
    .in('status', ['in_trip', 'closed'])
    .or('condition_ok.is.false,return_note.not.is.null')
    .order('updated_at', { ascending: false })
    .returns<TripRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать замечания: ${error.message}`);
  }

  const rows = (trips ?? []).filter((row) => row.car_id !== null);

  if (rows.length === 0) {
    return [];
  }

  const { data: handled, error: handledError } = await db
    .from('trip_events')
    .select('trip_id')
    .in(
      'trip_id',
      rows.map((row) => row.id),
    )
    .in('kind', HANDLED_EVENTS)
    .returns<EventRow[]>();

  if (handledError) {
    throw new Error(`Не удалось прочитать отметки об обработке: ${handledError.message}`);
  }

  const closed = new Set((handled ?? []).map((row) => row.trip_id));

  return rows
    .filter((row) => !closed.has(row.id))
    .map((row) => ({
      tripId: row.id,
      carId: row.car_id!,
      isRemark: row.condition_ok === false,
      text: row.return_note ?? 'без описания',
      at: row.keys_returned_at ?? row.updated_at,
      // Возврат оформляет водитель, если он был, иначе автор.
      author: row.drivers?.full_name ?? row.employees?.display_name ?? '—',
    }));
}

export type RemarkDecision = 'handled' | 'to_repair';

export type RemarkOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Закрыть замечание.
 *
 * `to_repair` вдобавок открывает период ремонта с текстом замечания: АХО не
 * должна переписывать его руками, иначе он потеряется по дороге.
 */
export async function decideRemark(
  tripId: number,
  decision: RemarkDecision,
  employeeId: string,
): Promise<RemarkOutcome> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select('id, car_id, condition_ok, return_note')
    .eq('id', tripId)
    .maybeSingle<{
      id: number;
      car_id: string | null;
      condition_ok: boolean | null;
      return_note: string | null;
    }>();

  if (error || !trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }

  const { data: already, error: alreadyError } = await db
    .from('trip_events')
    .select('trip_id')
    .eq('trip_id', tripId)
    .in('kind', HANDLED_EVENTS)
    .returns<EventRow[]>();

  if (alreadyError) {
    return { ok: false, reason: 'Не удалось проверить отметку. Попробуйте ещё раз.' };
  }
  if ((already ?? []).length > 0) {
    return { ok: false, reason: 'Это замечание уже закрыто.' };
  }

  if (decision === 'to_repair') {
    if (!trip.car_id) {
      return { ok: false, reason: 'У поездки нет машины.' };
    }

    const { error: repairError } = await db.from('car_repairs').insert({
      car_id: trip.car_id,
      since: new Date().toISOString().slice(0, 10),
      note: trip.return_note,
      created_by: employeeId,
    });

    if (repairError) {
      // Частичный уникальный индекс не даёт открыть второй ремонт на машину.
      const reason =
        repairError.code === '23505'
          ? 'Эта машина уже числится в ремонте. Замечание можно закрыть кнопкой «Исправлено».'
          : 'Не удалось отправить машину в ремонт.';
      return { ok: false, reason };
    }
  }

  const { error: eventError } = await db.from('trip_events').insert({
    trip_id: tripId,
    kind: decision === 'to_repair' ? 'remark_to_repair' : 'remark_handled',
    payload: {},
    actor_employee: employeeId,
  });

  if (eventError) {
    console.error(`Поездка #${tripId}: отметка об обработке не записана`, eventError);
    return { ok: false, reason: 'Решение не сохранилось. Попробуйте ещё раз.' };
  }

  return { ok: true };
}
