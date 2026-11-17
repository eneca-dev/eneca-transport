'use client';

import { Wrench } from 'lucide-react';

import { APP_TIMEZONE } from '@/config/app';

import type { Car } from './queries';

interface CarRowProps {
  car: Car;
  pending: boolean;
  onEdit: () => void;
  onStartRepair: () => void;
  onFinishRepair: () => void;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  timeZone: APP_TIMEZONE,
});

export function CarRow({ car, pending, onEdit, onStartRepair, onFinishRepair }: CarRowProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{car.model}</span>
          <span className="font-mono text-sm text-gray-600">{car.plate}</span>
          {car.inRepair ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              <Wrench className="size-3" aria-hidden />в ремонте
            </span>
          ) : (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
              исправна
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          одометр {car.odometerKm.toLocaleString('ru-RU')} км
          {car.inRepair && car.repairSince && (
            <>
              {' · '}в ремонте с {dateFormat.format(new Date(car.repairSince))}
              {car.repairNote && `, ${car.repairNote}`}
            </>
          )}
        </p>
      </div>

      <div className="flex gap-2">
        {car.inRepair ? (
          <button
            type="button"
            onClick={onFinishRepair}
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Исправлено
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartRepair}
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            В ремонт
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Изменить
        </button>
      </div>
    </li>
  );
}
