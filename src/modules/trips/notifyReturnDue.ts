import 'server-only';

import { cardK8 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { deliverOnce } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';

/**
 * К8: автору поездки без водителя — пора оформить возврат.
 *
 * Отправляется планировщиком в плановое время возврата. Поездку с водителем
 * возвращает сам водитель из Telegram, поэтому автору К8 не уходит: иначе
 * одометр вводили бы двое.
 */

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
  contract: string;
  purpose: string;
  author_id: string;
  odometer_start_km: number | null;
  cars: { plate: string; model: string } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, odometer_start_km, ' +
  'cars(plate, model), employees!trips_author_id_fkey(entra_oid, display_name)';

export async function notifyReturnDue(tripId: number): Promise<void> {
  const { data: trip, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip?.employees) {
    console.error(`Поездка #${tripId}: не удалось собрать данные для К8`, error);
    return;
  }

  const author = trip.employees;

  const data: TripCardData = {
    id: trip.id,
    startsAt: trip.starts_at,
    endsAt: trip.ends_at,
    route: trip.route,
    contract: trip.contract,
    purpose: trip.purpose,
    carLabel: trip.cars ? `${trip.cars.model} ${trip.cars.plate}` : null,
    driverLabel: null,
    authorName: author.display_name,
    participantNames: [],
  };

  await deliverOnce(
    {
      template: 'K8',
      channel: 'teams',
      tripId,
      recipient: { employeeId: trip.author_id },
      dedupeKey: `K8:trip:${tripId}`,
    },
    () =>
      sendCard(
        trip.author_id,
        author.entra_oid,
        cardK8(data, trip.odometer_start_km ?? 0),
      ),
  );
}
