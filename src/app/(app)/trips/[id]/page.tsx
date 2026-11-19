import { notFound } from 'next/navigation';

import { TripCardScreen } from '@/modules/trips/TripCardScreen';

/**
 * Э3 «Карточка поездки». Номер заявки — целое число (`bigint` в базе), поэтому
 * мусор в адресе отсекается здесь, а не внутри экрана.
 */
export default async function TripPage({ params }: PageProps<'/trips/[id]'>) {
  const { id } = await params;
  const tripId = Number(id);

  if (!Number.isInteger(tripId) || tripId <= 0) {
    notFound();
  }

  return <TripCardScreen tripId={tripId} />;
}
