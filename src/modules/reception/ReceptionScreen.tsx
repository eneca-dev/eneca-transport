'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY_SM, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { APP_TIMEZONE } from '@/config/app';
import { formatMoment, formatTime } from '@/lib/datetime';

import { acceptTripKeys, issueKeys, loadReceptionDay } from './actions';

import type { ReactNode } from 'react';
import type { ReceptionDay, ReceptionTrip } from './queries';

/**
 * Э4 «Рецепция: сегодня» — три блока: просроченные, выдача, возврат.
 *
 * Просроченные стоят первыми и не рисуются вовсе, когда их нет. «Выдать»
 * недоступно без готовых документов, «Принять» — без показания одометра:
 * оба запрета идут из инвариантов требований, а не из удобства экрана.
 */

const weekday = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  timeZone: APP_TIMEZONE,
});

interface SectionProps {
  title: string;
  empty: string;
  children: ReactNode;
  count: number;
  /** Пустой блок не рисовать вовсе: так делают просроченные. */
  hideWhenEmpty?: boolean;
}

function Section({ title, empty, count, children, hideWhenEmpty }: SectionProps) {
  if (count === 0 && hideWhenEmpty) {
    return null;
  }

  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-fg-soft uppercase">{title}</h2>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-fg-soft">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {children}
        </ul>
      )}
    </section>
  );
}

function people(trip: ReceptionTrip): string {
  const driver = trip.needsDriver
    ? trip.driverName
      ? `вод. ${trip.driverName}`
      : 'водитель не назначен'
    : 'без водителя';
  return `${trip.authorName} / ${driver}`;
}

export function ReceptionScreen() {
  const { getToken } = useTeamsAuth();

  const [day, setDay] = useState<ReceptionDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (action: (token: string) => Promise<Awaited<ReturnType<typeof loadReceptionDay>>>) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setDay(result.data);
            setError(null);
          } else {
            setError(result.error);
          }
        } catch {
          setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
        }
      });
    },
    [getToken],
  );

  useEffect(() => {
    run((token) => loadReceptionDay(token));
  }, [run]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Рецепция · {weekday.format(new Date())}</h1>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {day === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {day && (
        <>
          {/* Просроченные требуют действий, поэтому идут первыми. Когда их
              нет, блок не показывается вовсе: пустая строка наверху экрана
              отодвигает вниз то, с чем рецепция работает каждый день. */}
          <Section
            title="Просроченные"
            empty=""
            count={day.overdue.length}
            hideWhenEmpty
          >
            {day.overdue.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>{' '}
                    <span className="font-medium">{trip.carLabel ?? '—'}</span>{' '}
                    <span className="text-sm text-fg-soft">{people(trip)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-bad-fg">
                    Возврат был {formatMoment(new Date(trip.endsAt))} · ключи не сданы
                    {/* Без показания «Принять» неактивна. Причину надо писать
                        строкой: подсказка при наведении в Teams не видна. */}
                    <span className="text-fg-soft">
                      {trip.odometerEndKm === null
                        ? ` · одометр ждём от ${trip.needsDriver && trip.driverName ? trip.driverName : trip.authorName}`
                        : ` · одометр ${trip.odometerEndKm.toLocaleString('ru-RU')} км`}
                    </span>
                  </p>
                  {/* Занятый интервал считается от фактического возврата, и
                      поздний возврат может упереться в бронь, заведённую, пока
                      машину ждали. Причина нужна до нажатия: иначе кнопка
                      выглядит рабочей, а отказ приходит ошибкой. */}
                  {trip.blockedBy !== null && (
                    <p className="mt-0.5 text-sm text-warn-fg">
                      Принять нельзя: занято по {trip.blockedBy}. Перенесите или отмените эту
                      заявку.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => run((token) => acceptTripKeys(token, trip.id))}
                    disabled={pending || trip.odometerEndKm === null || trip.blockedBy !== null}
                    className={BUTTON_PRIMARY_SM}
                    title={
                      trip.odometerEndKm === null ? 'Сначала нужно показание одометра' : undefined
                    }
                  >
                    Принять
                  </button>
                  <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                    Открыть
                  </Link>
                </div>
              </li>
            ))}
          </Section>

          <Section title="Выдача" empty="На сегодня выдач нет." count={day.issues.length}>
            {day.issues.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="font-mono text-sm">{formatTime(new Date(trip.startsAt))}</span>
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>{' '}
                    <span className="font-medium">{trip.carLabel ?? 'машина не выбрана'}</span>{' '}
                    <span className="text-sm text-fg-soft">{people(trip)}</span>
                  </p>
                  <p className="mt-0.5 text-sm">
                    {trip.docsReady ? (
                      <span className="text-fg-soft">Документы: готовы</span>
                    ) : (
                      <span className={`${BADGE} bg-warn text-warn-fg`}>
                        <span className={BADGE_DOT} aria-hidden />
                        {trip.docsRecheckRequired
                          ? 'документы на повторной проверке'
                          : 'документы не готовы'}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => run((token) => issueKeys(token, trip.id))}
                    disabled={pending || !trip.docsReady}
                    className={BUTTON_PRIMARY_SM}
                    // Без готовых документов выдавать нечего: рецепция выдаёт
                    // их вместе с ключами.
                    title={trip.docsReady ? undefined : 'Сначала финотдел готовит документы'}
                  >
                    Выдать
                  </button>
                  <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                    Открыть
                  </Link>
                </div>
              </li>
            ))}
          </Section>

          <Section title="Возврат сегодня" empty="На сегодня возвратов нет." count={day.returns.length}>
            {day.returns.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="font-mono text-sm">{formatTime(new Date(trip.endsAt))}</span>
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>{' '}
                    <span className="font-medium">{trip.carLabel ?? '—'}</span>{' '}
                    <span className="text-sm text-fg-soft">{people(trip)}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-fg-soft">
                    {trip.odometerEndKm === null
                      ? `Одометр: ждём от ${trip.needsDriver && trip.driverName ? trip.driverName : trip.authorName}`
                      : `Одометр: ${trip.odometerEndKm.toLocaleString('ru-RU')} км`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Принять можно только после показания одометра: без него
                      поездку закрывать нельзя. */}
                  <button
                    type="button"
                    onClick={() => run((token) => acceptTripKeys(token, trip.id))}
                    disabled={pending || trip.odometerEndKm === null}
                    className={BUTTON_PRIMARY_SM}
                    title={
                      trip.odometerEndKm === null ? 'Сначала нужно показание одометра' : undefined
                    }
                  >
                    Принять
                  </button>
                  <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                    Открыть
                  </Link>
                </div>
              </li>
            ))}
          </Section>

          <p className="mt-6 text-xs text-fg-soft">
            «Принять» становится доступным, когда автор или водитель передал показание одометра.
            Досрочный возврат принимается так же — ждать планового времени не нужно. У
            просроченной поездки машина занята до момента сдачи, поэтому принять её нельзя, пока на
            это время есть другая бронь.
          </p>
        </>
      )}
    </div>
  );
}
