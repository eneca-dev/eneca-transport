'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY_SM, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { RoleAttention } from '@/modules/nav/RoleAttention';

import { loadMyTrips } from './actions';
import { tripLabelFrom } from './tripLabel';
import { groupTrips } from './tripGroups';
import { TONE_CLASS } from './tripStatus';

import type { TripListItem } from './queries';
import type { GroupedTrip } from './tripGroups';
import type { Viewer } from './tripStatus';

/** Э1 «Мои поездки»: свои заявки и те, где сотрудник участник. */

/** Сколько прошедших показывать сразу. Остальные — по кнопке. */
const PAST_SHOWN = 5;

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

function TripRow({ trip, state }: GroupedTrip) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* Первой строкой название: «Гомель/01.12» — куда и когда. Полный
            маршрут и номер ушли во вторую строку: номер нужен для ссылки и
            документов, а не для чтения. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 font-medium">
            {tripLabelFrom(trip.route, trip.startsAt, trip.endsAt)}
          </span>
          <span className={`${BADGE} ${TONE_CLASS[state.tone]}`}>
            <span className={BADGE_DOT} aria-hidden />
            {state.label}
          </span>
        </div>

        <p className="mt-0.5 text-sm text-fg-soft">
          {trip.route} · {details(trip)}
          <span className="font-mono"> · №{trip.id}</span>
        </p>

        {/* Третья строка появляется только когда ждут именно этого человека.
            Если ждут других — состояния достаточно. */}
        {state.waitingFor && (
          <p className="mt-0.5 text-sm font-medium text-brand-text">От вас: {state.waitingFor}</p>
        )}
      </div>

      <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
        Открыть
      </Link>
    </li>
  );
}

export function MyTripsScreen() {
  const { employee, getToken } = useTeamsAuth();

  const [trips, setTrips] = useState<TripListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allPast, setAllPast] = useState(false);
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

  const groups = trips ? groupTrips(trips, roles) : [];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Мои поездки</h1>
        <Link href="/trips/new" className={BUTTON_PRIMARY_SM}>
          <Plus className="size-4" aria-hidden />
          Новая поездка
        </Link>
      </div>

      {/* Дела служебных разделов — выше своих поездок: там ждут не тебя
          одного, а рецепцию или финотдел целиком. */}
      <RoleAttention />

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

      {groups.map((group) => {
        // Прошедшие показываются не все: их становится много, и они оттесняют
        // вниз то, что ещё предстоит.
        const hidden =
          group.key === 'past' && !allPast ? Math.max(0, group.trips.length - PAST_SHOWN) : 0;
        const shown = hidden > 0 ? group.trips.slice(0, PAST_SHOWN) : group.trips;

        return (
          <section key={group.key} className="mt-5 first:mt-0">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">
              {group.title}
              {group.key !== 'past' && group.trips.length > 1 && ` · ${group.trips.length}`}
            </h2>

            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {shown.map((row) => (
                <TripRow key={row.trip.id} {...row} />
              ))}
            </ul>

            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setAllPast(true)}
                className="mt-2 text-sm text-fg-soft underline underline-offset-2 transition-colors hover:text-fg"
              >
                Показать ещё {hidden}
              </button>
            )}
          </section>
        );
      })}

      {trips && (
        <p className="mt-6 text-xs text-fg-soft">
          Не разобраться?{' '}
          <Link href="/help" className="underline underline-offset-2">
            Как пользоваться
          </Link>
        </p>
      )}
    </section>
  );
}
