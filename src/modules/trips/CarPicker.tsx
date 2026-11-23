'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';

import { loadCarsForTrip } from './actions';
import { carBlockerText } from './blockerText';

import type { CarOption } from './availability';

interface CarPickerProps {
  tripId: number;
  currentCarLabel: string | null;
  pending: boolean;
  onPick: (carId: string) => void;
  onCancel: () => void;
}

/**
 * Смена машины (Э3).
 *
 * Нужна в первую очередь по К13: машину забрали в ремонт, и человек должен
 * выбрать другую, а не отменять поездку. Занятые показываются с причиной —
 * иначе непонятно, почему выбора нет.
 */
export function CarPicker({
  tripId,
  currentCarLabel,
  pending,
  onPick,
  onCancel,
}: CarPickerProps) {
  const { getToken } = useTeamsAuth();

  const [cars, setCars] = useState<CarOption[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadCarsForTrip(await getToken(), tripId);
        if (result.success) {
          setCars(result.data);
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

  const free = (cars ?? []).filter((car) => !car.blocked);

  return (
    <div className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">
        {currentCarLabel ? `Сменить машину: ${currentCarLabel}` : 'Выбрать машину'}
      </p>

      {error && <p className="mb-3 text-sm text-bad-fg">{error}</p>}

      {cars === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {cars !== null && cars.length === 0 && (
        <p className="text-sm text-fg-soft">В справочнике нет машин.</p>
      )}

      {cars !== null && cars.length > 0 && (
        <div className="grid gap-2">
          {cars.map((car) => (
            <label
              key={car.id}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                chosen === car.id ? 'border-brand bg-surface' : 'border-line'
              } ${car.blocked ? 'opacity-60' : 'cursor-pointer hover:bg-surface'}`}
            >
              <input
                type="radio"
                name="car"
                checked={chosen === car.id}
                disabled={car.blocked !== null || pending}
                onChange={() => setChosen(car.id)}
                className="mt-0.5 accent-brand"
              />
              <span className="min-w-0">
                <span className="font-medium">{car.model}</span>{' '}
                <span className="font-mono text-fg-soft">{car.plate}</span>
                {car.blocked && (
                  <span className="text-fg-soft"> — {carBlockerText(car.blocked)}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {cars !== null && cars.length > 0 && free.length === 0 && (
        <p className="mt-2 text-sm text-bad-fg">
          На это время свободных машин нет. Можно перенести поездку на другое время.
        </p>
      )}

      <p className="mt-3 text-xs text-fg-soft">
        Документы уйдут на повторную проверку: в них указана машина.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => chosen && onPick(chosen)}
          disabled={pending || loading || chosen === null}
          className={BUTTON_PRIMARY}
        >
          Сменить
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </div>
  );
}
