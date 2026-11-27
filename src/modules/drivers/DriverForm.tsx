'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { DriverInput } from './actions';
import type { Driver } from './queries';

interface DriverFormProps {
  /** Задан — форма правит водителя, пусто — добавляет нового. */
  driver?: Driver;
  pending: boolean;
  onSubmit: (input: DriverInput) => void;
  /** Только при правке: удалить ошибочно созданную запись. */
  onDelete?: () => void;
  onCancel: () => void;
}

export function DriverForm({ driver, pending, onSubmit, onDelete, onCancel }: DriverFormProps) {
  const [fullName, setFullName] = useState(driver?.fullName ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [comment, setComment] = useState(driver?.comment ?? '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ fullName, phone, comment });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Фамилия и имя</span>
          <input
            className={FIELD}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Ковалёв Сергей"
            autoFocus
          />
        </label>
        <label className="block">
          <span className={label}>Телефон</span>
          <input
            className={FIELD}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+375 29 123-45-67"
            inputMode="tel"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className={label}>Комментарий</span>
        <textarea
          className={FIELD}
          rows={2}
          maxLength={500}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {driver ? 'Сохранить' : 'Добавить'}
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
            Удалить водителя
          </button>
        )}
      </div>
    </form>
  );
}
