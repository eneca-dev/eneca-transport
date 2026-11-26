'use client';

import { BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/controls';
import { formatPeriod } from '@/lib/datetime';

import { carBlockerText, driverBlockerText } from './blockerText';

import type { ReactNode } from 'react';
import type { CarOption, DriverOption } from './availability';
import type { TripOptions } from './actions';

interface CarDriverStepProps {
  options: TripOptions;
  startsAt: Date;
  endsAt: Date;
  needsDriver: boolean;
  carId: string | null;
  driverId: string | null;
  pending: boolean;
  onPickCar: (id: string) => void;
  onPickDriver: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

interface ChoiceProps {
  name: string;
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}

function Choice({ name, checked, disabled, onPick, children }: ChoiceProps) {
  return (
    <label
      className={`flex items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
        checked ? 'border-brand bg-surface-soft' : 'border-line'
      } ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-soft'}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onPick}
        className="mt-0.5 accent-brand"
      />
      <span className="min-w-0 text-sm">{children}</span>
    </label>
  );
}

export function CarDriverStep({
  options,
  startsAt,
  endsAt,
  needsDriver,
  carId,
  driverId,
  pending,
  onPickCar,
  onPickDriver,
  onBack,
  onNext,
}: CarDriverStepProps) {
  const freeCars = options.cars.filter((car) => !car.blocked);
  const freeDrivers = options.drivers.filter((driver) => !driver.blocked);

  const ready = carId !== null && (!needsDriver || driverId !== null);

  return (
    <div>
      <p className="text-sm text-fg-soft">
        Свободно {formatPeriod(startsAt, endsAt)}
      </p>

      <h2 className="mt-4 mb-2 text-sm font-semibold">Машина</h2>
      {options.cars.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-fg-soft">
          В справочнике нет ни одной машины. Добавить их может АХО в разделе «Машины».
        </p>
      ) : (
        <div className="grid gap-2">
          {options.cars.map((car: CarOption) => (
            <Choice
              key={car.id}
              name="car"
              checked={carId === car.id}
              disabled={car.blocked !== null}
              onPick={() => onPickCar(car.id)}
            >
              <span className="font-medium">{car.model}</span>{' '}
              <span className="font-mono text-fg-soft">{car.plate}</span>
              {car.blocked && (
                <span className="text-fg-soft"> — {carBlockerText(car.blocked)}</span>
              )}
            </Choice>
          ))}
        </div>
      )}

      {options.cars.length > 0 && freeCars.length === 0 && (
        <p className="mt-2 text-sm text-bad-fg">
          На это время свободных машин нет. Измените даты на шаге 1.
        </p>
      )}

      {needsDriver && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold">Водитель</h2>
          {options.drivers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-fg-soft">
              В справочнике нет водителей. Либо поезжайте сами, либо попросите АХО завести
              водителей в разделе «Водители».
            </p>
          ) : (
            <div className="grid gap-2">
              {options.drivers.map((driver: DriverOption) => (
                <Choice
                  key={driver.id}
                  name="driver"
                  checked={driverId === driver.id}
                  disabled={driver.blocked !== null}
                  onPick={() => onPickDriver(driver.id)}
                >
                  <span className="font-medium">{driver.fullName}</span>
                  {driver.blocked && (
                    <span className="text-fg-soft"> — {driverBlockerText(driver.blocked)}</span>
                  )}
                  {/* Подключён ли у водителя Telegram, автору не показывается: это
                      забота АХО, и недоставленное сообщение уходит ей. */}
                </Choice>
              ))}
            </div>
          )}

          {options.drivers.length > 0 && freeDrivers.length === 0 && (
            <p className="mt-2 text-sm text-bad-fg">
              На это время свободных водителей нет. Измените даты или поезжайте сами.
            </p>
          )}
        </>
      )}

      <div className="mt-6 flex justify-between gap-2">
        <button type="button" onClick={onBack} disabled={pending} className={BUTTON_GHOST}>
          ← Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={pending || !ready}
          className={BUTTON_PRIMARY}
        >
          Далее →
        </button>
      </div>
    </div>
  );
}
