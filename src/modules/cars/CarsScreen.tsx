'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { BUTTON_PRIMARY_SM } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';

import {
  createCar,
  decideCarRemark,
  finishRepair,
  loadCars,
  startRepair,
  updateCar,
} from './actions';
import { CarForm } from './CarForm';
import { CarRow } from './CarRow';
import { RepairForm } from './RepairForm';

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
  const [repairing, setRepairing] = useState<Car | null>(null);
  const [pending, startTransition] = useTransition();

  /** Открытая форма всегда одна: иначе непонятно, что сохранится. */
  function closeForms() {
    setAdding(false);
    setEditing(null);
    setRepairing(null);
  }

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

  function handleStartRepair(car: Car, note: string) {
    run((token) => startRepair(token, car.id, note), () => setRepairing(null));
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Машины</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              closeForms();
              setAdding(true);
            }}
            className={BUTTON_PRIMARY_SM}
          >
            <Plus className="size-4" aria-hidden />
            Добавить
          </button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {adding && (
        <div className="mb-4">
          <CarForm pending={pending} onSubmit={handleCreate} onCancel={() => setAdding(false)} />
        </div>
      )}

      {cars === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {cars?.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-soft">
          Справочник пуст. Добавьте первую машину — нужны номер, модель и текущий одометр.
        </p>
      )}

      {cars && cars.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {cars.map((car) => {
            if (editing?.id === car.id) {
              return (
                <li key={car.id} className="p-4">
                  <CarForm
                    car={car}
                    pending={pending}
                    onSubmit={(input) => handleUpdate(car, input)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              );
            }

            if (repairing?.id === car.id) {
              return (
                <li key={car.id} className="p-4">
                  <RepairForm
                    car={car}
                    pending={pending}
                    onSubmit={(note) => handleStartRepair(car, note)}
                    onCancel={() => setRepairing(null)}
                  />
                </li>
              );
            }

            return (
              <CarRow
                key={car.id}
                car={car}
                pending={pending}
                onEdit={() => {
                  closeForms();
                  setEditing(car);
                }}
                onStartRepair={() => {
                  closeForms();
                  setRepairing(car);
                }}
                onFinishRepair={() => run((token) => finishRepair(token, car.id))}
                onDecideRemark={(tripId, decision) =>
                  run((token) => decideCarRemark(token, tripId, decision))
                }
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
