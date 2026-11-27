'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { CarInput } from './actions';
import type { Car } from './queries';

interface CarFormProps {
  /** Задана — форма правит машину, пусто — добавляет новую. */
  car?: Car;
  pending: boolean;
  onSubmit: (input: CarInput) => void;
  onCancel: () => void;
}

export function CarForm({ car, pending, onSubmit, onCancel }: CarFormProps) {
  const [plate, setPlate] = useState(car?.plate ?? '');
  const [model, setModel] = useState(car?.model ?? '');
  const [odometer, setOdometer] = useState(car?.odometerKm == null ? '' : String(car.odometerKm));
  const [comment, setComment] = useState(car?.comment ?? '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ plate, model, comment, odometerKm: odometer === '' ? null : Number(odometer) });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Номер</span>
          <input
            className={FIELD}
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            placeholder="1234 AB-7"
            autoFocus
          />
        </label>
        <label className="block">
          <span className={label}>Модель</span>
          <input
            className={FIELD}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Škoda Octavia"
          />
        </label>
        <label className="block">
          <span className={label}>Одометр, км</span>
          <input
            className={FIELD}
            value={odometer}
            onChange={(event) => setOdometer(event.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            required={car?.odometerKm != null}
            placeholder="85136"
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

      {car?.odometerKm == null && (
        <p className="mt-2 text-xs text-fg-soft">
          Машину можно будет забронировать после заполнения показания одометра.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {car ? 'Сохранить' : 'Добавить'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </form>
  );
}
