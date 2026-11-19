'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { BADGE, BADGE_DOT, BUTTON_SECONDARY, FIELD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { formatDayRange } from '@/lib/datetime';
import { toMinskDate } from '@/modules/trips/booking';

import { loadHistory, loadHistoryFilters } from './actions';

import type { FilterOption, HistoryResult } from './queries';

/**
 * Э7 «История поездок».
 *
 * Выгрузки в Excel нет: она в требованиях помечена как «желательно» и перенесена
 * в этап 2.
 */

/** Период по умолчанию — текущий месяц по минскому календарю. */
function defaultPeriod(): { since: string; until: string } {
  const now = new Date();
  const today = toMinskDate(now);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  return { since: firstOfMonth, until: today };
}

export function HistoryScreen() {
  const { getToken } = useTeamsAuth();

  const period = defaultPeriod();
  const [since, setSince] = useState(period.since);
  const [until, setUntil] = useState(period.until);
  const [carId, setCarId] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const [options, setOptions] = useState<{ cars: FilterOption[]; employees: FilterOption[] }>({
    cars: [],
    employees: [],
  });
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    (filters: { since: string; until: string; carId: string; employeeId: string }) => {
      startTransition(async () => {
        try {
          const token = await getToken();
          const loaded = await loadHistory(token, {
            since: filters.since,
            until: filters.until,
            carId: filters.carId || null,
            employeeId: filters.employeeId || null,
          });

          if (loaded.success) {
            setResult(loaded.data);
            setError(null);
          } else {
            setError(loaded.error);
          }
        } catch {
          setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
        }
      });
    },
    [getToken],
  );

  useEffect(() => {
    startTransition(async () => {
      try {
        const filters = await loadHistoryFilters(await getToken());
        if (filters.success) {
          setOptions(filters.data);
        }
      } catch {
        // Фильтры не критичны: без них история всё равно откроется за период.
      }
    });
  }, [getToken]);

  useEffect(() => {
    load({ since: period.since, until: period.until, carId: '', employeeId: '' });
    // Первая загрузка — за текущий месяц, дальше только по кнопке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <section>
      <h1 className="mb-4 text-lg font-semibold">История поездок</h1>

      <div className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4">
        <label className="block">
          <span className={label}>С</span>
          <input
            type="date"
            className={FIELD}
            value={since}
            onChange={(event) => setSince(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>По</span>
          <input
            type="date"
            className={FIELD}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>Машина</span>
          <select
            className={FIELD}
            value={carId}
            onChange={(event) => setCarId(event.target.value)}
          >
            <option value="">все</option>
            {options.cars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Сотрудник</span>
          <select
            className={FIELD}
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            <option value="">все</option>
            {options.employees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-4">
          <button
            type="button"
            onClick={() => load({ since, until, carId, employeeId })}
            disabled={pending}
            className={BUTTON_SECONDARY}
          >
            {pending ? 'Загружаю…' : 'Показать'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {result === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {result?.rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-soft">
          За этот период поездок нет.
        </p>
      )}

      {result && result.rows.length > 0 && (
        <>
          <p className="mb-2 text-sm text-fg-soft">
            Поездок: {result.rows.length} · суммарный пробег{' '}
            {result.totalKm.toLocaleString('ru-RU')} км
          </p>

          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {result.rows.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="w-20 text-sm">
                  {formatDayRange(new Date(trip.startsAt), new Date(trip.endsAt))}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-fg-soft">#{trip.id}</span>
                    <span className="font-medium">{trip.route}</span>
                    {trip.status === 'cancelled' && (
                      <span className={`${BADGE} bg-bad text-bad-fg`}>
                        <span className={BADGE_DOT} aria-hidden />
                        отменена
                      </span>
                    )}
                    {/* Замечание по машине отличается от примечания: его видно
                        сразу, потому что оно про исправность. */}
                    {trip.conditionOk === false && (
                      <span className={`${BADGE} bg-warn text-warn-fg`}>
                        <span className={BADGE_DOT} aria-hidden />
                        было замечание
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-fg-soft">
                    {trip.carLabel ?? 'машина не выбрана'} · {trip.authorName}
                    {trip.driverName ? ` · вод. ${trip.driverName}` : ' · без водителя'}
                  </p>
                  {trip.returnNote && (
                    <p className="mt-0.5 text-sm">
                      <span className="text-fg-soft">
                        {trip.conditionOk === false ? 'Замечание' : 'Примечание'}:{' '}
                      </span>
                      «{trip.returnNote}»
                    </p>
                  )}
                </div>

                <span className="w-20 text-right text-sm">
                  {trip.distanceKm !== null ? `${trip.distanceKm.toLocaleString('ru-RU')} км` : '—'}
                </span>

                <Link href={`/trips/${trip.id}`} className={BUTTON_SECONDARY}>
                  Открыть
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
