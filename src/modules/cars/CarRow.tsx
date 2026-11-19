'use client';

import { BADGE, BADGE_DOT, BUTTON_SECONDARY } from '@/components/controls';
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
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{car.model}</span>
          <span className="font-mono text-sm text-fg-soft">{car.plate}</span>
          {car.inRepair ? (
            <span className={`${BADGE} bg-warn text-warn-fg`}>
              <span className={BADGE_DOT} aria-hidden />в ремонте
            </span>
          ) : (
            <span className={`${BADGE} bg-ok text-ok-fg`}>
              <span className={BADGE_DOT} aria-hidden />
              исправна
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-fg-soft">
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
            className={BUTTON_SECONDARY}
          >
            Исправлено
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartRepair}
            disabled={pending}
            className={BUTTON_SECONDARY}
          >
            В ремонт
          </button>
        )}
        <button type="button" onClick={onEdit} disabled={pending} className={BUTTON_SECONDARY}>
          Изменить
        </button>
      </div>
    </li>
  );
}
