'use client';

import { useState } from 'react';

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
  const [odometer, setOdometer] = useState(car ? String(car.odometerKm) : '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ plate, model, odometerKm: Number(odometer) });
  }

  const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500';

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Номер</span>
          <input
            className={field}
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="1234 AB-7"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Модель</span>
          <input
            className={field}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Škoda Octavia"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Одометр, км</span>
          <input
            className={field}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="85136"
          />
        </label>
      </div>

      {/* Одометр новой машины становится начальным показанием первой поездки,
          поэтому о цене ошибки сказано прямо в форме. */}
      {!car && (
        <p className="mt-2 text-xs text-gray-500">
          Это показание станет начальным для первой поездки — сверьтесь с приборной панелью.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {car ? 'Сохранить' : 'Добавить'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
