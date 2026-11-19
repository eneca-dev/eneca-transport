'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY_SM, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatDayRange } from '@/lib/datetime';

import { loadMyTrips } from './actions';
import { STATUS_LABEL, STATUS_TONE, TONE_CLASS, whatNext } from './tripStatus';

import type { TripListItem } from './queries';

/** Э1 «Мои поездки»: свои заявки и те, где сотрудник участник. */

function carLabel(trip: TripListItem): string {
  const car = [trip.carModel, trip.carPlate].filter(Boolean).join(' ');
  const driver = trip.needsDriver
    ? trip.driverName
      ? `вод. ${trip.driverName}`
      : 'водитель не назначен'
    : 'без водителя';
  return car ? `${car}, ${driver}` : driver;
}

export function MyTripsScreen() {
  const { getToken } = useTeamsAuth();

  const [trips, setTrips] = useState<TripListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadMyTrips(await getToken());
        if (result.success) {
          setTrips(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }, [getToken]);

  useEffect(load, [load]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Мои поездки</h1>
        <Link href="/trips/new" className={BUTTON_PRIMARY_SM}>
          <Plus className="size-4" aria-hidden />
          Новая поездка
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {trips === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {trips?.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-soft">
          Поездок пока нет. Нажмите «Новая поездка», чтобы оформить заявку.
        </p>
      )}

      {trips && trips.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {trips.map((trip) => (
            <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>
                  <span className="text-sm">
                    {formatDayRange(new Date(trip.startsAt), new Date(trip.endsAt))}
                  </span>
                  <span className="font-medium">{trip.route}</span>
                  <span className={`${BADGE} ${TONE_CLASS[STATUS_TONE[trip.status]]}`}>
                    <span className={BADGE_DOT} aria-hidden />
                    {STATUS_LABEL[trip.status]}
                    {trip.status === 'closed' && trip.distanceKm !== null && (
                      <>, {trip.distanceKm.toLocaleString('ru-RU')} км</>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-fg-soft">
                  {carLabel(trip)}
                  {!trip.isAuthor && <> · я участник (автор — {trip.authorName})</>}
                </p>
                {/* Статуса мало: он не говорит, ждут ли чего-то от человека. */}
                {whatNext(trip) && (
                  <p className="mt-0.5 text-sm text-brand-text">{whatNext(trip)}</p>
                )}
              </div>

              <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                Открыть
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
