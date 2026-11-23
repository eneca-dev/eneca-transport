'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY_SM, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatDayRange } from '@/lib/datetime';

import { loadMyTrips } from './actions';
import { TONE_CLASS, tripState } from './tripStatus';

import type { TripListItem } from './queries';
import type { Viewer } from './tripStatus';

/** Э1 «Мои поездки»: свои заявки и те, где сотрудник участник. */

/**
 * Машина, водитель и роль смотрящего одной строкой.
 *
 * Отсутствие водителя — это не данные, а их отсутствие, поэтому пишется коротко
 * и серым, а не отдельным полем наравне с машиной.
 */
function details(trip: TripListItem): string {
  const parts: string[] = [];

  if (trip.carModel || trip.carPlate) {
    parts.push([trip.carModel, trip.carPlate].filter(Boolean).join(' '));
  }

  if (trip.needsDriver) {
    parts.push(trip.driverName ? `вод. ${trip.driverName}` : 'водитель не назначен');
  } else {
    parts.push('без водителя');
  }

  if (!trip.isAuthor) {
    parts.push(`я участник, автор — ${trip.authorName}`);
  }

  return parts.join(' · ');
}

export function MyTripsScreen() {
  const { employee, getToken } = useTeamsAuth();

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

  const roles: Omit<Viewer, 'isAuthor'> = {
    isAho: employee.roles.includes('aho'),
    isReception: employee.roles.includes('reception'),
    isFinance: employee.roles.includes('finance'),
  };

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
          {trips.map((trip) => {
            const state = tripState(trip, { ...roles, isAuthor: trip.isAuthor });

            return (
              <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  {/* Первой строкой то, по чему человек узнаёт поездку: когда и
                      куда. Номер ушёл во вторую строку — он нужен для ссылки,
                      а не для чтения. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm whitespace-nowrap">
                      {formatDayRange(new Date(trip.startsAt), new Date(trip.endsAt))}
                    </span>
                    <span className="min-w-0 font-medium">{trip.route}</span>
                    <span className={`${BADGE} ${TONE_CLASS[state.tone]}`}>
                      <span className={BADGE_DOT} aria-hidden />
                      {state.label}
                    </span>
                  </div>

                  <p className="mt-0.5 text-sm text-fg-soft">
                    {details(trip)}
                    <span className="font-mono"> · #{trip.id}</span>
                  </p>

                  {/* Третья строка появляется только когда ждут именно этого
                      человека. Если ждут других — состояния достаточно. */}
                  {state.waitingFor && (
                    <p className="mt-0.5 text-sm font-medium text-brand-text">
                      От вас: {state.waitingFor}
                    </p>
                  )}
                </div>

                <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                  Открыть
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
