'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { Car } from './queries';

interface RepairFormProps {
  car: Car;
  pending: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}

/**
 * Причина ремонта.
 *
 * Раньше здесь был window.prompt — Teams его не показывает: в клиенте
 * браузерные диалоги отключены, и машина уходила в ремонт без причины.
 * Поэтому поле своё.
 */
export function RepairForm({ car, pending, onSubmit, onCancel }: RepairFormProps) {
  const [note, setNote] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(note);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-soft">
          Что с машиной {car.plate}?
        </span>
        <input
          className={FIELD}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Замена сцепления"
          autoFocus
        />
      </label>

      <p className="mt-2 text-xs text-fg-soft">
        Причину видно в справочнике. Можно оставить пустой.
      </p>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          В ремонт
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </form>
  );
}
