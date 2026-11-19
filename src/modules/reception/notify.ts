import 'server-only';

import { cardK7 } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { formatMoment } from '@/lib/datetime';
import { deliverOnce } from '@/modules/notifications/outbox';

import type { TripCardData } from '@/lib/bots/cards';

/** Уведомления рецепции: К7 автору о выданных ключах. */

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
  drivers: { full_name: string } | null;
  employees: { entra_oid: string; display_name: string } | null;
}

const SELECT =
  'id, starts_at, ends_at, route, contract, purpose, author_id, odometer_start_km, ' +
  'cars(plate, model), drivers(full_name), ' +
  'employees!trips_author_id_fkey(entra_oid, display_name)';

/**
 * К7: ключи выданы.
 *
 * Отправляется автору, даже если за рулём водитель: отвечает за машину и за
 * срок возврата всё равно автор заявки.
 */
export async function notifyKeysIssued(tripId: number): Promise<void> {
  const { data: trip, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip?.employees) {
    console.error(`Поездка #${tripId}: не удалось собрать данные для К7`, error);
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
    driverLabel: trip.drivers?.full_name ?? null,
    authorName: author.display_name,
    participantNames: [],
  };

  await deliverOnce(
    {
      template: 'K7',
      channel: 'teams',
      tripId,
      recipient: { employeeId: trip.author_id },
      dedupeKey: `K7:trip:${tripId}`,
    },
    () =>
      sendCard(
        trip.author_id,
        author.entra_oid,
        cardK7(data, formatMoment(new Date(trip.ends_at)), trip.odometer_start_km ?? 0),
      ),
  );
}
