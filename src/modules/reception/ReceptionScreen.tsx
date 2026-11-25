'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import {
  BADGE,
  BADGE_DOT,
  BUTTON_PRIMARY_SM,
  BUTTON_SECONDARY,
  FIELD,
} from '@/components/controls';
import { useNavCounts } from '@/components/NavCounts';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { APP_TIMEZONE } from '@/config/app';
import { formatMoment, formatTime } from '@/lib/datetime';
import { toMinskDate } from '@/modules/trips/booking';
import { tripLabelFrom } from '@/modules/trips/tripLabel';

import { acceptTripKeys, issueKeys, loadReceptionDay } from './actions';

import type { ReactNode } from 'react';
import type { ReceptionDay, ReceptionTrip } from './queries';

/**
 * Э4 «Рецепция: сегодня» — четыре блока: просроченные, досрочный возврат,
 * выдача, возврат.
 *
 * Просроченные и досрочные стоят первыми: в обоих случаях машина уже у
 * рецепции, и ключи надо принять сейчас. Выдачи и плановые возвраты идут по
 * расписанию дня, поэтому ниже. Пустые блоки просроченных и досрочных не
 * рисуются вовсе: пустая строка наверху отодвигает вниз то, с чем рецепция
 * работает каждый день.
 *
 * Стрелками листаются другие дни — чтобы видеть, что будет завтра, а не только
 * сегодняшнюю очередь. Другой день показывается без кнопок: выдать и принять
 * ключи можно только сейчас, машина стоит у рецепции в настоящем времени.
 *
 * «Выдать» недоступно без готовых документов, «Принять» — без показания
 * одометра: оба запрета идут из инвариантов требований, а не из удобства
 * экрана.
 */

const weekday = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  timeZone: APP_TIMEZONE,
});

/** Полдень, чтобы разбор даты не уехал через сутки. */
function dayStart(day: string): Date {
  return new Date(`${day}T12:00:00+03:00`);
}

function shiftDay(day: string, days: number): string {
  return toMinskDate(new Date(dayStart(day).getTime() + days * 24 * 60 * 60 * 1000));
}

interface SectionProps {
  title: string;
  empty: string;
  children: ReactNode;
  count: number;
  /** Пустой блок не рисовать вовсе: так делают просроченные и досрочные. */
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

/** От кого ждут показание одометра: за рулём был водитель или сам автор. */
function odometerFrom(trip: ReceptionTrip): string {
  if (trip.needsDriver && trip.driverName) {
    // Телефон водителя — чтобы звонить сразу, а не искать его в справочнике.
    // Телефонов сотрудников в приложении нет, поэтому у автора его не будет.
    return trip.driverPhone
      ? `${trip.driverName}, ${trip.driverPhone}`
      : trip.driverName;
  }
  return trip.authorName;
}

/** Состояние поездки на другой день: вместо кнопки, которой там нет. */
function planLabel(trip: ReceptionTrip): string {
  if (trip.status === 'closed') {
    return 'закрыта';
  }
  if (trip.status === 'in_trip') {
    return trip.odometerEndKm === null ? 'в пути' : 'одометр передан';
  }
  if (trip.docsReady) {
    return 'документы готовы';
  }
  return trip.docsRecheckRequired ? 'документы на повторной проверке' : 'документы не готовы';
}

interface RowProps {
  trip: ReceptionTrip;
  /** Время слева: выезд или возврат. */
  time?: string;
  /** Строка под основной: одометр, просрочка, документы. */
  detail: ReactNode;
  /** Кнопка действия. На другой день её нет. */
  action?: ReactNode;
}

function Row({ trip, time, detail, action }: RowProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      {time && <span className="font-mono text-sm">{time}</span>}
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-medium">
            {tripLabelFrom(trip.route, trip.startsAt, trip.endsAt)}
          </span>{' '}
          <span className="text-sm">{trip.carLabel ?? '—'}</span>{' '}
          <span className="text-sm text-fg-soft">
            {people(trip)} · <span className="font-mono">№{trip.id}</span>
          </span>
        </p>
        {detail}
      </div>
      <div className="flex flex-wrap gap-2">
        {action}
        <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
          Открыть
        </Link>
      </div>
    </li>
  );
}

export function ReceptionScreen() {
  const { getToken } = useTeamsAuth();
  const { refresh } = useNavCounts();

  // Так же, как период по умолчанию в Э7: дата считается при первой отрисовке.
  // Если вкладку не закрывать до полуночи, сегодняшним останется прежний день —
  // но сервер в ответе скажет `isToday: false`, и кнопки действий исчезнут,
  // а не станут относиться к другому дню.
  const [today] = useState(() => toMinskDate(new Date()));
  const [day, setDay] = useState(today);
  const [data, setData] = useState<ReceptionDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (
      action: (token: string) => Promise<Awaited<ReturnType<typeof loadReceptionDay>>>,
      /** Это действие, а не чтение: после него метки надо пересчитать сразу. */
      mutating = false,
    ) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setData(result.data);
            setError(null);
            if (mutating) {
              refresh();
            }
          } else {
            setError(result.error);
          }
        } catch {
          setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
        }
      });
    },
    [getToken, refresh],
  );

  useEffect(() => {
    run((token) => loadReceptionDay(token, day));
  }, [run, day]);

  // Кнопки показываются только на сегодняшнем дне, и только когда данные
  // действительно сегодняшние: иначе нажатие относилось бы к другому дню.
  const live = data !== null && data.isToday && day === today;

  const acceptButton = (trip: ReceptionTrip): ReactNode => (
    <button
      type="button"
      onClick={() => run((token) => acceptTripKeys(token, trip.id), true)}
      disabled={pending || trip.odometerEndKm === null}
      className={BUTTON_PRIMARY_SM}
      title={trip.odometerEndKm === null ? 'Сначала нужно показание одометра' : undefined}
    >
      Принять
    </button>
  );

  const odometerLine = (trip: ReceptionTrip): ReactNode => (
    <p className="mt-0.5 text-sm text-fg-soft">
      {trip.odometerEndKm === null
        ? `Одометр: ждём от ${odometerFrom(trip)}`
        : `Одометр: ${trip.odometerEndKm.toLocaleString('ru-RU')} км`}
    </p>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold">
          Рецепция · {weekday.format(dayStart(day))}
          {day === today && ' · сегодня'}
        </h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDay(shiftDay(day, -1))}
            disabled={pending}
            className={BUTTON_SECONDARY}
            aria-label="Предыдущий день"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <input
            type="date"
            value={day}
            onChange={(event) => event.target.value && setDay(event.target.value)}
            className={`${FIELD} w-auto`}
            aria-label="Какой день показать"
          />
          <button
            type="button"
            onClick={() => setDay(shiftDay(day, 1))}
            disabled={pending}
            className={BUTTON_SECONDARY}
            aria-label="Следующий день"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          {day !== today && (
            <button type="button" onClick={() => setDay(today)} className={BUTTON_SECONDARY}>
              Сегодня
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {data === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {data && (
        <>
          {!live && (
            <p className="mb-4 rounded-md border border-line-strong bg-surface-soft px-4 py-3 text-sm text-fg-soft">
              Другой день показан для просмотра. Выдать и принять ключи можно только сегодня.
            </p>
          )}

          {/* Просроченные требуют действий, поэтому идут первыми. */}
          <Section title="Просроченные" empty="" count={data.overdue.length} hideWhenEmpty>
            {data.overdue.map((trip) => (
              <Row
                key={trip.id}
                trip={trip}
                detail={
                  <p className="mt-0.5 text-sm text-bad-fg">
                    Возврат был {formatMoment(new Date(trip.endsAt))} · ключи не сданы
                    {/* Без показания «Принять» неактивна. Причину надо писать
                        строкой: подсказка при наведении в Teams не видна. */}
                    <span className="text-fg-soft">
                      {trip.odometerEndKm === null
                        ? ` · одометр ждём от ${odometerFrom(trip)}`
                        : ` · одометр ${trip.odometerEndKm.toLocaleString('ru-RU')} км`}
                    </span>
                  </p>
                }
                action={live ? acceptButton(trip) : undefined}
              />
            ))}
          </Section>

          {/* Машину привезли раньше планового дня: ждать этого дня не нужно. */}
          <Section title="Досрочный возврат" empty="" count={data.early.length} hideWhenEmpty>
            {data.early.map((trip) => (
              <Row
                key={trip.id}
                trip={trip}
                detail={
                  <p className="mt-0.5 text-sm">
                    <span className="text-fg-soft">
                      Плановый возврат {formatMoment(new Date(trip.endsAt))} ·{' '}
                    </span>
                    <span className="text-ok-fg">
                      одометр {(trip.odometerEndKm ?? 0).toLocaleString('ru-RU')} км
                    </span>
                  </p>
                }
                action={live ? acceptButton(trip) : undefined}
              />
            ))}
          </Section>

          <Section
            title="Выдача"
            empty={live ? 'На сегодня выдач нет.' : 'Выездов в этот день нет.'}
            count={data.issues.length}
          >
            {data.issues.map((trip) => (
              <Row
                key={trip.id}
                trip={trip}
                time={formatTime(new Date(trip.startsAt))}
                detail={
                  <p className="mt-0.5 text-sm">
                    {!live ? (
                      <span className="text-fg-soft">{planLabel(trip)}</span>
                    ) : trip.docsReady ? (
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
                }
                action={
                  live ? (
                    <button
                      type="button"
                      onClick={() => run((token) => issueKeys(token, trip.id), true)}
                      disabled={pending || !trip.docsReady}
                      className={BUTTON_PRIMARY_SM}
                      // Без готовых документов выдавать нечего: рецепция выдаёт
                      // их вместе с ключами.
                      title={trip.docsReady ? undefined : 'Сначала финотдел готовит документы'}
                    >
                      Выдать
                    </button>
                  ) : undefined
                }
              />
            ))}
          </Section>

          <Section
            title={live ? 'Возврат сегодня' : 'Возврат'}
            empty={live ? 'На сегодня возвратов нет.' : 'Возвратов в этот день нет.'}
            count={data.returns.length}
          >
            {data.returns.map((trip) => (
              <Row
                key={trip.id}
                trip={trip}
                time={formatTime(new Date(trip.endsAt))}
                detail={
                  live ? (
                    odometerLine(trip)
                  ) : (
                    <p className="mt-0.5 text-sm text-fg-soft">{planLabel(trip)}</p>
                  )
                }
                /* Принять можно только после показания одометра: без него
                   поездку закрывать нельзя. */
                action={live ? acceptButton(trip) : undefined}
              />
            ))}
          </Section>

          {/* «Не выехали» внизу и серым: за ключами не пришли, работа на
              сегодня этим не становится, но и теряться такие заявки не должны. */}
          <Section title="Не выехали" empty="" count={data.stale.length} hideWhenEmpty>
            {data.stale.map((trip) => (
              <Row
                key={trip.id}
                trip={trip}
                detail={
                  <p className="mt-0.5 text-sm text-fg-soft">
                    Выезд был {formatMoment(new Date(trip.startsAt))} · за ключами не пришли
                  </p>
                }
              />
            ))}
          </Section>

          {live && data.stale.length > 0 && (
            <p className="mt-2 text-xs text-fg-soft">
              Если поездка не состоялась, её стоит отменить в заявке: иначе она останется в истории
              незакрытой, а машина — числиться занятой на то время.
            </p>
          )}

          {live && (
            <p className="mt-6 text-xs text-fg-soft">
              «Принять» становится доступным, когда автор или водитель передал показание одометра.
              Машину, привезённую раньше планового дня, принимайте из блока «Досрочный возврат» —
              ждать этого дня не нужно. Просроченная поездка принимается тоже: другая бронь на эту
              машину не мешает. Выдать её следующему можно через десять минут после приёма.
            </p>
          )}
        </>
      )}
    </div>
  );
}
