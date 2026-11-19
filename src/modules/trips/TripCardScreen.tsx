'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ArrowLeft } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatMoment, formatPeriod } from '@/lib/datetime';

import { loadTripCard, submitTripReturn } from './actions';
import { ReturnForm } from './ReturnForm';
import {
  CONFIRMATION_LABEL,
  CONFIRMATION_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TONE_CLASS,
  whatNext,
} from './tripStatus';

import type { TripCard, TripEvent } from './queries';

/**
 * Э3 «Карточка поездки».
 *
 * Кнопок «Перенести» и «Отменить» пока нет: перенос и отмена — это И7. Мёртвых
 * кнопок не держим, появятся вместе с действиями.
 */

interface TripCardScreenProps {
  tripId: number;
}

/** Что произошло — словами. Незнакомый вид события показываем как есть. */
const EVENT_LABEL: Record<string, string> = {
  booked: 'бронь создана',
  driver_confirmed: 'водитель подтвердил',
  driver_declined: 'водитель отказался',
  docs_ready: 'документы готовы',
  keys_issued: 'ключи выданы',
  keys_returned: 'ключи приняты',
  closed: 'поездка закрыта',
  cancelled: 'поездка отменена',
  rescheduled: 'поездка перенесена',
};

function eventLabel(event: TripEvent): string {
  return EVENT_LABEL[event.kind] ?? event.kind;
}

export function TripCardScreen({ tripId }: TripCardScreenProps) {
  const { getToken } = useTeamsAuth();

  const [trip, setTrip] = useState<TripCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadTripCard(await getToken(), tripId);
        if (result.success) {
          setTrip(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }, [getToken, tripId]);

  useEffect(load, [load]);

  /**
   * «Оформить возврат» показывается только автору поездки без водителя:
   * поездку с водителем возвращает сам водитель из Telegram, и две точки
   * ввода одометра расходились бы.
   */
  const canReturn =
    trip !== null &&
    trip.status === 'in_trip' &&
    trip.odometerEndKm === null &&
    !trip.needsDriver &&
    trip.isAuthor;

  if (error) {
    return (
      <section>
        <p className="rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-fg-soft hover:text-fg"
        >
          <ArrowLeft className="size-4" aria-hidden />к моим поездкам
        </Link>
      </section>
    );
  }

  if (!trip) {
    return <p className="text-sm text-fg-soft">Загрузка…</p>;
  }

  const people = [
    `${trip.authorName} (автор)`,
    ...trip.participants.map((person) => person.displayName),
  ].join(', ');

  return (
    <section>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-fg-soft hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />к моим поездкам
      </Link>

      <div className="mt-3 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Поездка #{trip.id}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${BADGE} ${TONE_CLASS[STATUS_TONE[trip.status]]}`}>
            <span className={BADGE_DOT} aria-hidden />
            {STATUS_LABEL[trip.status]}
          </span>
          {trip.docsRecheckRequired && (
            <span className={`${BADGE} ${TONE_CLASS.warn}`}>
              <span className={BADGE_DOT} aria-hidden />
              требуется проверка документов
            </span>
          )}
        </div>
      </div>

      {whatNext(trip) && (
        <p className="mb-4 rounded-md border border-line bg-surface-soft px-4 py-3 text-sm">
          <span className="text-fg-soft">Сейчас: </span>
          {whatNext(trip)}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <p className="font-medium">
          {formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt))}
          <span className="text-fg-soft"> · </span>
          {trip.route}
        </p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-soft">Участники</dt>
          <dd className="min-w-0 break-words">{people}</dd>

          <dt className="text-fg-soft">Договор</dt>
          <dd>{trip.contract}</dd>

          <dt className="text-fg-soft">Цель</dt>
          <dd className="min-w-0 break-words">{trip.purpose}</dd>

          <dt className="text-fg-soft">Машина</dt>
          <dd>
            {trip.carModel ? `${trip.carModel} ${trip.carPlate}` : 'не выбрана'}
          </dd>

          <dt className="text-fg-soft">Водитель</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {trip.needsDriver ? (trip.driverName ?? 'не назначен') : 'без водителя'}
            {trip.needsDriver && (
              <span className={`${BADGE} ${TONE_CLASS[CONFIRMATION_TONE[trip.driverConfirmation]]}`}>
                <span className={BADGE_DOT} aria-hidden />
                {CONFIRMATION_LABEL[trip.driverConfirmation]}
              </span>
            )}
          </dd>

          {trip.odometerStartKm !== null && (
            <>
              <dt className="text-fg-soft">Одометр</dt>
              <dd>
                {trip.odometerStartKm.toLocaleString('ru-RU')}
                {trip.odometerEndKm !== null && (
                  <> → {trip.odometerEndKm.toLocaleString('ru-RU')} км</>
                )}
                {trip.distanceKm !== null && (
                  <span className="text-fg-soft">
                    {' '}
                    · пробег {trip.distanceKm.toLocaleString('ru-RU')} км
                  </span>
                )}
              </dd>
            </>
          )}

          {trip.returnNote && (
            <>
              <dt className="text-fg-soft">Примечание</dt>
              <dd className="min-w-0 break-words">{trip.returnNote}</dd>
            </>
          )}
        </dl>
      </div>

      {canReturn && !returning && (
        <button
          type="button"
          onClick={() => setReturning(true)}
          className={`${BUTTON_PRIMARY} mt-4`}
        >
          Оформить возврат
        </button>
      )}

      {returning && trip && (
        <div className="mt-4">
          <ReturnForm
            odometerStartKm={trip.odometerStartKm}
            pending={pending}
            onCancel={() => setReturning(false)}
            onSubmit={(input) =>
              startTransition(async () => {
                try {
                  const result = await submitTripReturn(await getToken(), tripId, input);
                  if (result.success) {
                    setTrip(result.data);
                    setError(null);
                    setReturning(false);
                  } else {
                    setError(result.error);
                  }
                } catch {
                  setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
                }
              })
            }
          />
        </div>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Журнал</h2>
      {trip.events.length === 0 ? (
        <p className="text-sm text-fg-soft">Пока ничего не происходило.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {trip.events.map((event) => (
            <li key={event.id} className="flex flex-wrap gap-x-3 px-4 py-2 text-sm">
              <span className="text-fg-soft">{formatMoment(new Date(event.createdAt))}</span>
              {event.actorName && <span>{event.actorName}</span>}
              <span className="text-fg-soft">— {eventLabel(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
