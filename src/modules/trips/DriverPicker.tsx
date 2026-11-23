'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';

import { loadDriversForTrip } from './actions';
import { driverBlockerText } from './blockerText';

import type { DriverOption } from './availability';

interface DriverPickerProps {
  tripId: number;
  /** Кто назначен сейчас — его не предлагаем выбрать заново. */
  currentDriverName: string | null;
  pending: boolean;
  onPick: (driverId: string) => void;
  onCancel: () => void;
}

/**
 * Выбор водителя для замены (Э3, только АХО).
 *
 * Занятые и недоступные показываются с причиной и не выбираются — то же
 * правило, что на шаге 2 в Э2: человек должен видеть, почему выбора нет, а не
 * пустой список.
 */
export function DriverPicker({
  tripId,
  currentDriverName,
  pending,
  onPick,
  onCancel,
}: DriverPickerProps) {
  const { getToken } = useTeamsAuth();

  const [drivers, setDrivers] = useState<DriverOption[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadDriversForTrip(await getToken(), tripId);
        if (result.success) {
          setDrivers(result.data);
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

  const free = (drivers ?? []).filter((driver) => !driver.blocked);

  return (
    <div className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">
        {currentDriverName ? `Заменить водителя: ${currentDriverName}` : 'Назначить водителя'}
      </p>

      {error && <p className="mb-3 text-sm text-bad-fg">{error}</p>}

      {drivers === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {drivers !== null && drivers.length === 0 && (
        <p className="text-sm text-fg-soft">
          В справочнике нет водителей. Завести их можно в разделе «Водители».
        </p>
      )}

      {drivers !== null && drivers.length > 0 && (
        <div className="grid gap-2">
          {drivers.map((driver) => (
            <label
              key={driver.id}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                chosen === driver.id ? 'border-brand bg-surface' : 'border-line'
              } ${driver.blocked ? 'opacity-60' : 'cursor-pointer hover:bg-surface'}`}
            >
              <input
                type="radio"
                name="replacement"
                checked={chosen === driver.id}
                disabled={driver.blocked !== null || pending}
                onChange={() => setChosen(driver.id)}
                className="mt-0.5 accent-brand"
              />
              <span className="min-w-0">
                <span className="font-medium">{driver.fullName}</span>
                {driver.blocked && (
                  <span className="text-fg-soft"> — {driverBlockerText(driver.blocked)}</span>
                )}
                {/* Без привязки Telegram запрос подтверждения до водителя не
                    дойдёт: бот не может написать первым. */}
                {!driver.blocked && !driver.telegramLinked && (
                  <span className="block text-xs text-warn-fg">
                    Telegram не подключён — запрос подтверждения не дойдёт
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {drivers !== null && drivers.length > 0 && free.length === 0 && (
        <p className="mt-2 text-sm text-bad-fg">
          На это время свободных водителей нет. Можно перенести поездку или поехать без водителя.
        </p>
      )}

      <p className="mt-3 text-xs text-fg-soft">
        Новому водителю уйдёт запрос подтверждения и 15 минут на ответ. Прежнему — сообщение, что
        ехать не нужно. Документы пойдут на повторную проверку.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => chosen && onPick(chosen)}
          disabled={pending || loading || chosen === null}
          className={BUTTON_PRIMARY}
        >
          Назначить
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </div>
  );
}
