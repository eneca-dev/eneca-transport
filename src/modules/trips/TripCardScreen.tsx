'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatMoment, formatPeriod } from '@/lib/datetime';

import {
  assignDriverAction,
  cancelTripAction,
  changeCarAction,
  confirmForDriverAction,
  correctOdometerAction,
  editTripAction,
  loadTripCard,
  rescheduleTripAction,
  submitTripReturn,
} from './actions';
import { CarPicker } from './CarPicker';
import { CorrectionForm } from './CorrectionForm';
import { DriverPicker } from './DriverPicker';
import { EditTripForm } from './EditTripForm';
import { RescheduleForm } from './RescheduleForm';
import { ReturnForm } from './ReturnForm';
import { tripLabelFrom } from './tripLabel';
import { describeForJournal } from './changeLog';
import { CONFIRMATION_LABEL, CONFIRMATION_TONE, TONE_CLASS, tripState } from './tripStatus';

import type { TripCard } from './queries';

/**
 * Э3 «Карточка поездки».
 *
 * Делится на три блока: главное (когда, куда, с кем, на чём), данные для
 * документов и то, что появилось в самой поездке. Пустые поля не показываются:
 * «Водитель: без водителя» — это отсутствие данных, а не данные.
 */

interface TripCardScreenProps {
  tripId: number;
}

/** Что произошло — словами. Незнакомый вид события показываем как есть. */
const EVENT_LABEL: Record<string, string> = {
  booked: 'бронь создана',
  driver_confirmed: 'водитель подтвердил',
  driver_declined: 'водитель отказался',
  driver_timeout: 'водитель не подтвердил за 15 минут',
  driver_dropped: 'водитель снят, поедет автор',
  driver_assigned: 'назначен водитель',
  driver_confirmed_by_aho: 'АХО подтвердила за водителя',
  trip_edited: 'заявка изменена',
  car_changed: 'сменилась машина',
  driver_unassigned: 'водитель снят: недоступен',
  docs_ready: 'документы готовы',
  keys_issued: 'ключи выданы',
  return_submitted: 'передано показание одометра',
  driver_return_completed: 'водитель закончил оформление возврата',
  keys_returned: 'ключи приняты',
  closed: 'поездка закрыта',
  cancelled: 'поездка отменена',
  rescheduled: 'поездка перенесена',
  odometer_corrected: 'исправлено показание одометра',
  remark_handled: 'замечание закрыто',
  remark_to_repair: 'машина отправлена в ремонт',
};

export function TripCardScreen({ tripId }: TripCardScreenProps) {
  const { employee, getToken } = useTeamsAuth();

  const [trip, setTrip] = useState<TripCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [correctingClosed, setCorrectingClosed] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pickingCar, setPickingCar] = useState(false);
  /** Правка заявки раскрывается по кнопке: главное действие должно быть одно. */
  const [showChanges, setShowChanges] = useState(false);
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
  const isAho = employee.roles.includes('aho');

  const canReturn =
    trip !== null && trip.status === 'in_trip' && !trip.needsDriver && trip.isAuthor;
  const correcting = trip !== null && trip.odometerEndKm !== null;

  /**
   * Перенос и отмена — до выдачи ключей, автору или АХО. После выдачи поездка
   * идёт своим ходом: отменять выданную машину бессмысленно, её принимают.
   */
  const canChange =
    trip !== null &&
    ['booked', 'docs_ready'].includes(trip.status) &&
    trip.keysIssuedAt === null;

  /**
   * Решение по водителю нужно сейчас: его нет, он отказался или не ответил.
   *
   * Только в этих случаях кнопка стоит главной. Когда водитель назначен и
   * подтвердил, заменить его тоже можно — но это уже правка заявки, и место ей
   * под «Изменить заявку».
   */
  const driverNeedsDecision =
    canChange &&
    isAho &&
    trip.needsDriver &&
    (trip.driverName === null ||
      trip.driverConfirmation === 'declined' ||
      trip.driverConfirmation === 'timeout');

  /** Подтвердить за водителя: он ответил голосом по телефону. */
  const canConfirmForDriver =
    canChange &&
    isAho &&
    trip.needsDriver &&
    trip.driverName !== null &&
    trip.driverConfirmation !== 'confirmed' &&
    trip.driverConfirmation !== 'declined';

  /** Одно действие за раз: иначе непонятно, что сохранится. */
  function closeForms() {
    setReturning(false);
    setRescheduling(false);
    setConfirmCancel(false);
    setCorrectingClosed(false);
    setAssigning(false);
    setEditing(false);
    setPickingCar(false);
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

  const state = tripState(trip, {
    isAuthor: trip.isAuthor,
    isAho: employee.roles.includes('aho'),
    isReception: employee.roles.includes('reception'),
    isFinance: employee.roles.includes('finance'),
  });

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

      {/* Шапка: когда, куда и одно состояние. Номер — подписью: он нужен для
          ссылки и разговора, а не для чтения. */}
      <div className="mt-3 mb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold">
            {formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt))}
          </h1>
          <span className={`${BADGE} ${TONE_CLASS[state.tone]}`}>
            <span className={BADGE_DOT} aria-hidden />
            {state.label}
          </span>
        </div>
        <p className="mt-1 text-base font-medium">
          {tripLabelFrom(trip.route, trip.startsAt, trip.endsAt)}
        </p>
        <p className="mt-0.5 text-sm text-fg-soft">
          {trip.route} · поездка <span className="font-mono">№{trip.id}</span>
        </p>
      </div>

      {state.waitingFor && (
        <p className="mb-4 rounded-md border border-brand bg-surface-soft px-4 py-3 text-sm font-medium">
          От вас: {state.waitingFor}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-soft">Едут</dt>
          <dd className="min-w-0 break-words">{people}</dd>

          <dt className="text-fg-soft">Машина</dt>
          <dd>{trip.carModel ? `${trip.carModel} ${trip.carPlate}` : 'не выбрана'}</dd>

          {/* Водитель показывается только когда он нужен: иначе строка
              «без водителя» стоит наравне с настоящими данными. */}
          {trip.needsDriver && (
            <>
              <dt className="text-fg-soft">Водитель</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {trip.driverName ?? 'не назначен'}
                <span
                  className={`${BADGE} ${TONE_CLASS[CONFIRMATION_TONE[trip.driverConfirmation]]}`}
                >
                  <span className={BADGE_DOT} aria-hidden />
                  {CONFIRMATION_LABEL[trip.driverConfirmation]}
                </span>
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* Данные для документов отдельным блоком: автору они нужны один раз при
          оформлении, а финотделу — каждый раз. */}
      <h2 className="mt-4 mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">
        Для документов
      </h2>
      <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-soft">Договор</dt>
          <dd>{trip.contract}</dd>

          <dt className="text-fg-soft">Цель</dt>
          <dd className="min-w-0 break-words">{trip.purpose}</dd>
        </dl>
      </div>

      {/* Блок появляется только после выдачи ключей: до неё одометра и
          примечаний нет, и пустые строки только мешают. */}
      {trip.keysIssuedAt !== null && (
        <>
          <h2 className="mt-4 mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">
            Одометр и возврат
          </h2>
          <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-soft">Ключи выданы</dt>
              <dd>{formatMoment(new Date(trip.keysIssuedAt))}</dd>

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

              {trip.keysReturnedAt !== null && (
                <>
                  <dt className="text-fg-soft">Ключи приняты</dt>
                  <dd>{formatMoment(new Date(trip.keysReturnedAt))}</dd>
                </>
              )}

              {trip.returnNote && (
                <>
                  <dt className="text-fg-soft">
                    {trip.conditionOk === false ? 'Замечание' : 'Примечание'}
                  </dt>
                  <dd className="min-w-0 break-words">{trip.returnNote}</dd>
                </>
              )}
            </dl>
          </div>
        </>
      )}

      {/* Главное действие — крупной кнопкой и одно. Правка заявки убрана под
          «Изменить заявку»: раньше шесть кнопок стояли в ряд наравне, и из них
          не было видно, что сейчас от человека нужно. */}
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
        {trip.status === 'closed' &&
          trip.odometerEndKm !== null &&
          isAho &&
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

        {/* Водителя нет, он отказался или не ответил — решение нужно сейчас,
            поэтому кнопка главная, а не под «Изменить заявку». */}
        {driverNeedsDecision && !assigning && (
          <button
            type="button"
            onClick={() => {
              closeForms();
              setAssigning(true);
            }}
            className={BUTTON_PRIMARY}
          >
            {trip.driverName ? 'Заменить водителя' : 'Назначить водителя'}
          </button>
        )}

        {canConfirmForDriver && trip.driverConfirmation === 'timeout' && (
          <button
            type="button"
            onClick={() => apply((token) => confirmForDriverAction(token, tripId))}
            disabled={pending}
            className={BUTTON_SECONDARY}
          >
            Подтвердить за водителя
          </button>
        )}

        {canChange && !showChanges && (
          <button
            type="button"
            onClick={() => setShowChanges(true)}
            className={`${BUTTON_SECONDARY} inline-flex items-center gap-1.5`}
          >
            Изменить заявку
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {canChange && showChanges && (
        <div className="mt-3 rounded-lg border border-line bg-surface-soft p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">
            Изменить заявку
          </p>
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  closeForms();
                  setEditing(true);
                }}
                className={BUTTON_SECONDARY}
              >
                Маршрут, договор, цель, участники
              </button>
            )}

            {!pickingCar && (
              <button
                type="button"
                onClick={() => {
                  closeForms();
                  setPickingCar(true);
                }}
                className={BUTTON_SECONDARY}
              >
                Сменить машину
              </button>
            )}

            {/* Та же кнопка, что выше, но здесь — когда решение не срочное. */}
            {isAho && !driverNeedsDecision && !assigning && (
              <button
                type="button"
                onClick={() => {
                  closeForms();
                  setAssigning(true);
                }}
                className={BUTTON_SECONDARY}
              >
                {trip.needsDriver && trip.driverName ? 'Заменить водителя' : 'Назначить водителя'}
              </button>
            )}

            {canConfirmForDriver && trip.driverConfirmation !== 'timeout' && (
              <button
                type="button"
                onClick={() => apply((token) => confirmForDriverAction(token, tripId))}
                disabled={pending}
                className={BUTTON_SECONDARY}
              >
                Подтвердить за водителя
              </button>
            )}

            {!rescheduling && !confirmCancel && (
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
        </div>
      )}

      {/* Отмена необратима и освобождает машину, поэтому спрашиваем ещё раз.
          Своим диалогом, а не браузерным: Teams его не показывает. */}
      {confirmCancel && (
        <div className="mt-4 rounded-lg border border-bad-line bg-bad p-4 text-sm text-bad-fg">
          <p className="font-medium">
            Отменить {tripLabelFrom(trip.route, trip.startsAt, trip.endsAt)}?
          </p>
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

      {correctingClosed && trip.odometerEndKm !== null && (
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

      {editing && (
        <div className="mt-4">
          <EditTripForm
            trip={trip}
            pending={pending}
            onCancel={() => setEditing(false)}
            onSubmit={(input) => apply((token) => editTripAction(token, tripId, input))}
          />
        </div>
      )}

      {pickingCar && (
        <div className="mt-4">
          <CarPicker
            tripId={tripId}
            currentCarLabel={trip.carModel ? `${trip.carModel} ${trip.carPlate}` : null}
            pending={pending}
            onCancel={() => setPickingCar(false)}
            onPick={(carId) => apply((token) => changeCarAction(token, tripId, carId))}
          />
        </div>
      )}

      {assigning && (
        <div className="mt-4">
          <DriverPicker
            tripId={tripId}
            currentDriverName={trip.needsDriver ? trip.driverName : null}
            pending={pending}
            onCancel={() => setAssigning(false)}
            onPick={(driverId) => apply((token) => assignDriverAction(token, tripId, driverId))}
          />
        </div>
      )}

      {rescheduling && (
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

      {returning && (
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
            onSubmit={(input) => apply((token) => submitTripReturn(token, tripId, input))}
          />
        </div>
      )}

      <h2 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">
        Журнал
      </h2>
      {trip.events.length === 0 ? (
        <p className="text-sm text-fg-soft">Пока ничего не происходило.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {trip.events.map((event) => {
            const extra = describeForJournal(event);
            return (
              <li key={event.id} className="px-4 py-2 text-sm">
                <span className="text-fg-soft">{formatMoment(new Date(event.createdAt))}</span>
                {event.actorName && <span className="ml-3">{event.actorName}</span>}
                <span className="ml-3 text-fg-soft">
                  — {EVENT_LABEL[event.kind] ?? event.kind}
                </span>
                {/* Подробности уже лежат в базе: раньше в журнале стояло просто
                    «поездка перенесена», без того, что именно изменилось. */}
                {extra && <span className="block text-fg-soft sm:ml-3 sm:inline">{extra}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
