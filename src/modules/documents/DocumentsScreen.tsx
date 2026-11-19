'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { BADGE, BADGE_DOT, BUTTON_PRIMARY_SM, BUTTON_SECONDARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatDayRange, formatPeriod } from '@/lib/datetime';

import { loadDocumentQueue, markDocsReady } from './actions';

import type { DocumentQueueItem } from './queries';

/** Э5 «Очередь документов». Ведёт финотдел, видит и АХО. */
export function DocumentsScreen() {
  const { getToken } = useTeamsAuth();

  const [queue, setQueue] = useState<DocumentQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (action: (token: string) => Promise<Awaited<ReturnType<typeof loadDocumentQueue>>>) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setQueue(result.data);
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
    run((token) => loadDocumentQueue(token));
  }, [run]);

  return (
    <section>
      <h1 className="mb-4 text-lg font-semibold">Очередь документов</h1>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {queue === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {queue?.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-soft">
          Очередь пуста — по всем заявкам документы готовы.
        </p>
      )}

      {queue && queue.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {queue.map((trip) => (
            <li key={trip.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>
                  <span className="text-sm">
                    {formatDayRange(new Date(trip.startsAt), new Date(trip.endsAt))}
                  </span>
                  <span className="font-medium">{trip.route}</span>
                  {/* Повторная проверка выделяется: прежний комплект уже не годится. */}
                  {trip.recheck && (
                    <span className={`${BADGE} bg-warn text-warn-fg`}>
                      <span className={BADGE_DOT} aria-hidden />
                      изменена — проверить заново
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-sm text-fg-soft">
                  {[trip.authorName, ...trip.participantNames].join(', ')} · договор{' '}
                  {trip.contract}
                </p>
                <p className="mt-0.5 text-sm text-fg-soft">
                  {formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt))} ·{' '}
                  {trip.carLabel ?? 'машина не выбрана'} ·{' '}
                  {trip.driverName ? `вод. ${trip.driverName}` : 'без водителя'}
                </p>
                <p className="mt-0.5 text-sm">Цель: {trip.purpose}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => run((token) => markDocsReady(token, trip.id))}
                  disabled={pending}
                  className={BUTTON_PRIMARY_SM}
                >
                  Документы готовы
                </button>
                <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                  Открыть
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
