import 'server-only';

import { cardK11Correction } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { listEmployeesByRole } from '@/modules/employees/queries';
import { deliverOnce } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';

/**
 * Исправление показания одометра после закрытия поездки.
 *
 * Делает только АХО и только с причиной — так записано в требованиях.
 * Сохраняются прежнее и новое значения, кто и когда исправил: без этого
 * непонятно, почему пробег в истории не сходится с одометром машины.
 *
 * Показания последующих поездок автоматически не меняются. Это намеренно:
 * ошибка могла быть разовой опечаткой, и сдвигать за ней всю цепочку значило бы
 * подменять данные, которых никто не вводил. АХО получает предупреждение и
 * решает сама.
 */

export type CorrectionOutcome = { ok: true } | { ok: false; reason: string };

interface TripRow {
  id: number;
  status: string;
  route: string;
  starts_at: string;
  ends_at: string;
  contract: string;
  purpose: string;
  car_id: string | null;
  closed_at: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  cars: { plate: string; model: string } | null;
  employees: { display_name: string } | null;
}

const SELECT =
  'id, status, route, starts_at, ends_at, contract, purpose, car_id, closed_at, ' +
  'odometer_start_km, odometer_end_km, cars(plate, model), ' +
  'employees!trips_author_id_fkey(display_name)';

export async function correctClosedOdometer(
  tripId: number,
  employeeId: string,
  valueKm: number,
  reason: string,
): Promise<CorrectionOutcome> {
  const db = getDb();

  const { data: trip, error } = await db
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    return { ok: false, reason: 'Поездка не найдена.' };
  }
  if (trip.status !== 'closed') {
    return {
      ok: false,
      reason: 'Поездка ещё не закрыта — показание исправляет тот, кто его отправил.',
    };
  }
  if (trip.odometer_end_km === null || trip.odometer_start_km === null) {
    return { ok: false, reason: 'У поездки нет показаний одометра.' };
  }
  if (valueKm < trip.odometer_start_km) {
    return {
      ok: false,
      reason:
        `Новое значение меньше начального (${trip.odometer_start_km.toLocaleString('ru-RU')} км). ` +
        'Пробег не может быть отрицательным.',
    };
  }
  if (valueKm === trip.odometer_end_km) {
    return { ok: false, reason: 'Это то же значение, что уже записано.' };
  }

  const previous = trip.odometer_end_km;
  const now = new Date().toISOString();

  const { error: updateError } = await db
    .from('trips')
    .update({ odometer_end_km: valueKm, updated_at: now })
    .eq('id', tripId)
    .eq('status', 'closed');

  if (updateError) {
    console.error(`Поездка #${tripId}: не удалось исправить одометр`, updateError);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  const { error: readingError } = await db.from('odometer_readings').insert({
    trip_id: tripId,
    car_id: trip.car_id,
    kind: 'correction',
    value_km: valueKm,
    previous_value_km: previous,
    reason,
    entered_by_employee: employeeId,
  });

  if (readingError) {
    console.error(`Поездка #${tripId}: исправление не попало в историю`, readingError);
  }

  await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'odometer_corrected',
    payload: { previous_value_km: previous, value_km: valueKm, reason },
    actor_employee: employeeId,
  });

  // Поездки той же машины, закрытые позже этой: их показания не трогаем, но
  // АХО должна знать, что цепочка могла поехать.
  let affectedLater = 0;

  if (trip.car_id && trip.closed_at) {
    const { data: later } = await db
      .from('trips')
      .select('id')
      .eq('car_id', trip.car_id)
      .eq('status', 'closed')
      .gt('closed_at', trip.closed_at)
      .returns<{ id: number }[]>();

    affectedLater = (later ?? []).length;

    // Текущее показание машины равно значению последнего возврата. Если позже
    // этой поездки закрытых нет, исправление меняет и его.
    if (affectedLater === 0) {
      const { error: carError } = await db
        .from('cars')
        .update({ odometer_km: valueKm, updated_at: now })
        .eq('id', trip.car_id);

      if (carError) {
        console.error(`Поездка #${tripId}: одометр машины не обновлён`, carError);
      }
    }
  }

  await notifyCorrection(trip, employeeId, previous, valueKm, reason, affectedLater);

  return { ok: true };
}

async function notifyCorrection(
  trip: TripRow,
  employeeId: string,
  previousKm: number,
  newKm: number,
  reason: string,
  affectedLater: number,
): Promise<void> {
  const db = getDb();

  const { data: author } = await db
    .from('employees')
    .select('display_name')
    .eq('id', employeeId)
    .maybeSingle<{ display_name: string }>();

  const data: TripCardData = {
    id: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    contract: trip.contract,
    purpose: trip.purpose,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    driverLabel: null,
    authorName: trip.employees?.display_name ?? '—',
    participantNames: [],
  };

  const card = cardK11Correction(
    data,
    author?.display_name ?? 'АХО',
    previousKm,
    newKm,
    reason,
    affectedLater,
  );

  const recipients = await listEmployeesByRole('aho');

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template: 'K11',
          channel: 'teams',
          tripId: trip.id,
          recipient: { employeeId: person.id },
          // В ключ входит новое значение: каждое исправление — своё сообщение.
          dedupeKey: `K11:trip:${trip.id}:correction:${newKm}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, card),
      ),
    ),
  );
}
