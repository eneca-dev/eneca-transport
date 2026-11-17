'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { useTeamsAuth } from '@/components/TeamsAuth';

import { createCar, finishRepair, loadCars, startRepair, updateCar } from './actions';
import { CarForm } from './CarForm';
import { CarRow } from './CarRow';

import type { ActionResult } from '@/lib/types';
import type { CarInput } from './actions';
import type { Car } from './queries';

/** Э8 «Машины». Справочник ведёт АХО. */
export function CarsScreen() {
  const { getToken } = useTeamsAuth();

  const [cars, setCars] = useState<Car[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Car | null>(null);
  const [pending, startTransition] = useTransition();

  /** Все действия возвращают новый список: экран не расходится с базой. */
  const run = useCallback(
    (action: (token: string) => Promise<ActionResult<Car[]>>, onDone?: () => void) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setCars(result.data);
            setError(null);
            onDone?.();
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
    run((token) => loadCars(token));
  }, [run]);

  function handleCreate(input: CarInput) {
    run((token) => createCar(token, input), () => setAdding(false));
  }

  function handleUpdate(car: Car, input: CarInput) {
    run((token) => updateCar(token, car.id, input), () => setEditing(null));
  }

  function handleStartRepair(car: Car) {
    const note = window.prompt(`Что с машиной ${car.plate}?`) ?? '';
    run((token) => startRepair(token, car.id, note));
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Машины</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditing(null);
            }}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="size-4" aria-hidden />
            Добавить
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {adding && (
        <div className="mb-4">
          <CarForm pending={pending} onSubmit={handleCreate} onCancel={() => setAdding(false)} />
        </div>
      )}

      {cars === null && !error && <p className="text-sm text-gray-500">Загрузка…</p>}

      {cars?.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Справочник пуст. Добавьте первую машину — нужны номер, модель и текущий одометр.
        </p>
      )}

      {cars && cars.length > 0 && (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {cars.map((car) =>
            editing?.id === car.id ? (
              <li key={car.id} className="p-4">
                <CarForm
                  car={car}
                  pending={pending}
                  onSubmit={(input) => handleUpdate(car, input)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <CarRow
                key={car.id}
                car={car}
                pending={pending}
                onEdit={() => {
                  setEditing(car);
                  setAdding(false);
                }}
                onStartRepair={() => handleStartRepair(car)}
                onFinishRepair={() => run((token) => finishRepair(token, car.id))}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
