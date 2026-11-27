'use client';

import { BADGE, BADGE_DOT, BUTTON_SECONDARY } from '@/components/controls';
import { formatDay } from '@/lib/datetime';

import type { Car } from './queries';

interface CarRowProps {
  car: Car;
  pending: boolean;
  onEdit: () => void;
  onStartRepair: () => void;
  onFinishRepair: () => void;
  /** Решение по замечанию: «Исправлено»/«Принято» либо «В ремонт». */
  onDecideRemark: (tripId: number, decision: 'handled' | 'to_repair') => void;
}

export function CarRow({
  car,
  pending,
  onEdit,
  onStartRepair,
  onFinishRepair,
  onDecideRemark,
}: CarRowProps) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
          {car.odometerKm === null
            ? 'Пробег не указан'
            : `Одометр ${car.odometerKm.toLocaleString('ru-RU')} км`}
          {car.inRepair && car.repairSince && (
            <>
              {' · '}в ремонте с {formatDay(new Date(car.repairSince))}
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
      </div>

      {/* Замечания и примечания из возвратов. Замечание требует решения,
          примечание достаточно принять к сведению — отсюда разные кнопки. */}
      {car.remarks.map((remark) => (
        <div
          key={remark.tripId}
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface-soft px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            <span className={remark.isRemark ? 'text-warn-fg' : 'text-fg-soft'}>
              {remark.isRemark ? 'Замечание' : 'Примечание'}:
            </span>{' '}
            «{remark.text}», {formatDay(new Date(remark.at))}
            <span className="text-fg-soft">
              {' · '}поездка #{remark.tripId}, {remark.author}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            {remark.isRemark && !car.inRepair && (
              <button
                type="button"
                onClick={() => onDecideRemark(remark.tripId, 'to_repair')}
                disabled={pending}
                className={BUTTON_SECONDARY}
              >
                В ремонт
              </button>
            )}
            <button
              type="button"
              onClick={() => onDecideRemark(remark.tripId, 'handled')}
              disabled={pending}
              className={BUTTON_SECONDARY}
            >
              {remark.isRemark ? 'Исправлено' : 'Принято'}
            </button>
          </span>
        </div>
      ))}
    </li>
  );
}
