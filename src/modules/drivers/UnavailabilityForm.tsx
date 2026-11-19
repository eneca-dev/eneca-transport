'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { UnavailabilityInput } from './actions';
import type { Driver, DriverUnavailability, UnavailabilityReason } from './queries';

interface UnavailabilityFormProps {
  driver: Driver;
  /** Задан — правим существующий период, пусто — отмечаем новый. */
  period?: DriverUnavailability;
  pending: boolean;
  onSubmit: (input: UnavailabilityInput) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const REASONS: { value: UnavailabilityReason; label: string }[] = [
  { value: 'sick', label: 'болезнь' },
  { value: 'vacation', label: 'отпуск' },
  { value: 'other', label: 'другое' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function UnavailabilityForm({
  driver,
  period,
  pending,
  onSubmit,
  onDelete,
  onCancel,
}: UnavailabilityFormProps) {
  const [since, setSince] = useState(period?.since ?? today());
  const [until, setUntil] = useState(period?.until ?? today());
  const [reason, setReason] = useState<UnavailabilityReason>(period?.reason ?? 'sick');
  const [note, setNote] = useState(period?.note ?? '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ since, until, reason, note });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">
        {period ? 'Период недоступности' : 'Отметить недоступность'}: {driver.fullName}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
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
          <span className={label}>По включительно</span>
          <input
            type="date"
            className={FIELD}
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className={label}>Причина</legend>
        <div className="flex flex-wrap gap-4">
          {REASONS.map((item) => (
            <label key={item.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="reason"
                value={item.value}
                checked={reason === item.value}
                onChange={() => setReason(item.value)}
                className="accent-brand"
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block">
        <span className={label}>Примечание</span>
        <input
          className={FIELD}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="необязательно"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          Сохранить
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className={`${BUTTON_GHOST} ml-auto text-bad-fg`}
          >
            Удалить период
          </button>
        )}
      </div>
    </form>
  );
}
