import 'server-only';

import { cardK9, cardK10, cardK11 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { listEmployeesByRole } from '@/modules/employees/queries';
import { deliverOnce } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';
import type { ReturnActor } from './returnService';

/** Уведомления вокруг возврата: К9 автору, К10 и К11 в АХО. */

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  condition_ok: boolean | null;
  return_note: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  distance_km: number | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, condition_ok, return_note, ' +
  'odometer_start_km, odometer_end_km, distance_km, ' +
  'cars(plate, model), drivers(full_name), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

async function loadTrip(tripId: number): Promise<{ trip: TripRow; data: TripCardData } | null> {
  const { data: trip, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    console.error(`Поездка #${tripId}: не удалось собрать данные для уведомлений`, error);
    return null;
  }

  return {
    trip,
    data: {
      id: trip.id,
      startsAt: trip.starts_at,
      endsAt: trip.ends_at,
      route: trip.route,
      contract: trip.contract,
      purpose: trip.purpose,
      carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
      driverLabel: trip.drivers?.full_name ?? null,
      authorName: trip.employees?.display_name ?? '—',
      participantNames: [],
    },
  };
}

/** Как назвать того, кто оформлял возврат. */
async function actorName(actor: ReturnActor): Promise<string> {
  const db = getDb();

  if ('employeeId' in actor) {
    const { data } = await db
      .from('employees')
      .select('display_name')
      .eq('id', actor.employeeId)
      .maybeSingle<{ display_name: string }>();
    return data?.display_name ?? 'сотрудник';
  }

  const { data } = await db
    .from('drivers')
    .select('full_name')
    .eq('id', actor.driverId)
    .maybeSingle<{ full_name: string }>();
  return data?.full_name ?? 'водитель';
}

/** Разослать карточку всем активным сотрудникам АХО. */
async function toAho(
  template: string,
  tripId: number,
  dedupeSuffix: string,
  card: unknown,
): Promise<void> {
  const recipients = await listEmployeesByRole('aho');

  await Promise.all(
    recipients.map((person) =>
      deliverOnce(
        {
          template,
          channel: 'teams',
          tripId,
          recipient: { employeeId: person.id },
          dedupeKey: `${template}:trip:${tripId}:${dedupeSuffix}:employee:${person.id}`,
        },
        () => sendCard(person.id, person.entraOid, card),
      ),
    ),
  );
}

/** К11: введено показание меньше начального. */
export async function notifyAhoOdometerTooLow(
  tripId: number,
  enteredKm: number,
  actor: ReturnActor,
): Promise<void> {
  const loaded = await loadTrip(tripId);

  if (!loaded) {
    return;
  }

  const who = await actorName(actor);

  // В ключ входит введённое значение: вторая попытка с тем же числом — та же
  // ошибка, а с другим — новая, и о ней стоит сообщить.
  await toAho(
    'K11',
    tripId,
    `low:${enteredKm}`,
    cardK11(loaded.data, who, loaded.trip.odometer_start_km ?? 0, enteredKm),
  );
}

/** К10: замечание или примечание при возврате. */
export async function notifyAhoRemark(tripId: number): Promise<void> {
  const loaded = await loadTrip(tripId);

  if (!loaded) {
    return;
  }

  const isRemark = loaded.trip.condition_ok === false;
  const text = loaded.trip.return_note ?? (isRemark ? 'без описания' : '');
  const who = loaded.trip.drivers?.full_name ?? loaded.data.authorName;

  await toAho(
    'K10',
    tripId,
    isRemark ? 'remark' : 'note',
    cardK10(loaded.data, who, text, isRemark),
  );
}

/** К9: поездка закрыта. */
export async function notifyTripClosed(tripId: number): Promise<void> {
  const loaded = await loadTrip(tripId);

  if (!loaded?.trip.employees) {
    return;
  }

  const author = loaded.trip.employees;

  await deliverOnce(
    {
      template: 'K9',
      channel: 'teams',
      tripId,
      recipient: { employeeId: loaded.trip.author_id },
      dedupeKey: `K9:trip:${tripId}`,
    },
    () =>
      sendCard(
        loaded.trip.author_id,
        author.entra_oid,
        cardK9(
          loaded.data,
          loaded.trip.distance_km ?? 0,
          loaded.trip.odometer_end_km ?? 0,
        ),
      ),
  );
}
