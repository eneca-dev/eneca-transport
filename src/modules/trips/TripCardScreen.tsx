'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ArrowLeft } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatMoment, formatPeriod } from '@/lib/datetime';

import {
  cancelTripAction,
  correctOdometerAction,
  loadTripCard,
  rescheduleTripAction,
  submitTripReturn,
} from './actions';
import { CorrectionForm } from './CorrectionForm';
import { RescheduleForm } from './RescheduleForm';
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
  const { employee, getToken } = useTeamsAuth();

  const [trip, setTrip] = useState<TripCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [correctingClosed, setCorrectingClosed] = useState(false);
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
   * Возврат оформляет и исправляет автор поездки без водителя: поездку с
   * водителем возвращает сам водитель из Telegram, и две точки ввода одометра
   * расходились бы.
   *
   * Исправление доступно, пока рецепция не приняла ключи — так записано в
   * требованиях: «ошибка до закрытия поездки — отправитель исправляет своё
   * значение, пробег пересчитывается».
   */
  const canReturn =
    trip !== null && trip.status === 'in_trip' && !trip.needsDriver && trip.isAuthor;
  const correcting = trip !== null && trip.odometerEndKm !== null;

  /**
   * Перенос и отмена — до выдачи ключей, автору или АХО. После выдачи поездка
   * идёт своим ходом: отменять выданную машину бессмысленно, её принимают.
   *
   * Право АХО проверяет сервер; здесь кнопки показываются автору, а АХО видит
   * их в любой поездке.
   */
  const canChange =
    trip !== null &&
    ['booked', 'docs_ready'].includes(trip.status) &&
    trip.keysIssuedAt === null;

  /** Одно действие за раз: иначе непонятно, что сохранится. */
  function closeForms() {
    setReturning(false);
    setRescheduling(false);
    setConfirmCancel(false);
    setCorrectingClosed(false);
  }

  /** Обновить карточку после действия, показав ошибку, если она была. */
  function apply(action: (token: string) => Promise<Awaited<ReturnType<typeof loadTripCard>>>) {
    startTransition(async () => {
      try {
        const result = await action(await getToken());
        if (result.success) {
          setTrip(result.data);
          setError(null);
          closeForms();
        } else {
          setError(result.error);
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }

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

      <div className="mt-4 flex flex-wrap gap-2">
        {canReturn && !returning && (
          <button
            type="button"
            onClick={() => {
              closeForms();
              setReturning(true);
            }}
            className={BUTTON_PRIMARY}
          >
            {correcting ? 'Исправить показание' : 'Оформить возврат'}
          </button>
        )}

        {/* Исправление после закрытия — только АХО и только с причиной. */}
        {trip !== null &&
          trip.status === 'closed' &&
          trip.odometerEndKm !== null &&
          employee.roles.includes('aho') &&
          !correctingClosed && (
            <button
              type="button"
              onClick={() => {
                closeForms();
                setCorrectingClosed(true);
              }}
              className={BUTTON_SECONDARY}
            >
              Исправить показание
            </button>
          )}

        {canChange && !rescheduling && !confirmCancel && (
          <>
            <button
              type="button"
              onClick={() => {
                closeForms();
                setRescheduling(true);
              }}
              className={BUTTON_SECONDARY}
            >
              Перенести
            </button>
            <button
              type="button"
              onClick={() => {
                closeForms();
                setConfirmCancel(true);
              }}
              className={`${BUTTON_SECONDARY} text-bad-fg`}
            >
              Отменить
            </button>
          </>
        )}
      </div>

      {/* Отмена необратима и освобождает машину, поэтому спрашиваем ещё раз.
          Своим диалогом, а не браузерным: Teams его не показывает. */}
      {confirmCancel && trip && (
        <div className="mt-4 rounded-lg border border-bad-line bg-bad p-4 text-sm text-bad-fg">
          <p className="font-medium">Отменить поездку #{trip.id}?</p>
          <p className="mt-1">
            Машина и водитель освободятся, подготовка документов прекратится. Отменённую поездку
            не вернуть — придётся оформлять заявку заново.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => apply((token) => cancelTripAction(token, tripId))}
              disabled={pending}
              className={BUTTON_PRIMARY}
            >
              Да, отменить
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              disabled={pending}
              className={BUTTON_SECONDARY}
            >
              Не отменять
            </button>
          </div>
        </div>
      )}

      {correctingClosed && trip && trip.odometerEndKm !== null && (
        <div className="mt-4">
          <CorrectionForm
            odometerStartKm={trip.odometerStartKm}
            odometerEndKm={trip.odometerEndKm}
            pending={pending}
            onCancel={() => setCorrectingClosed(false)}
            onSubmit={(input) => apply((token) => correctOdometerAction(token, tripId, input))}
          />
        </div>
      )}

      {rescheduling && trip && (
        <div className="mt-4">
          <RescheduleForm
            startsAt={trip.startsAt}
            endsAt={trip.endsAt}
            hasDriver={trip.needsDriver}
            pending={pending}
            onCancel={() => setRescheduling(false)}
            onSubmit={(input) => apply((token) => rescheduleTripAction(token, tripId, input))}
          />
        </div>
      )}

      {returning && trip && (
        <div className="mt-4">
          <ReturnForm
            odometerStartKm={trip.odometerStartKm}
            current={
              correcting
                ? {
                    odometerKm: trip.odometerEndKm,
                    conditionOk: trip.conditionOk,
                    note: trip.returnNote,
                  }
                : undefined
            }
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
