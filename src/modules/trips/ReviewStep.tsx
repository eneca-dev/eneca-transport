'use client';

import { BUTTON_GHOST, BUTTON_PRIMARY } from '@/components/controls';
import { formatMoment } from '@/lib/datetime';

import type { TripOptions } from './actions';
import type { TripDetails } from './TripDetailsStep';

interface ReviewStepProps {
  details: TripDetails;
  options: TripOptions;
  carId: string;
  driverId: string | null;
  startsAt: Date;
  endsAt: Date;
  pending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export function ReviewStep({
  details,
  options,
  carId,
  driverId,
  startsAt,
  endsAt,
  pending,
  onBack,
  onSubmit,
}: ReviewStepProps) {
  const car = options.cars.find((option) => option.id === carId);
  const driver = driverId ? options.drivers.find((option) => option.id === driverId) : null;

  const rows: { label: string; value: string }[] = [
    { label: 'Выезд', value: formatMoment(startsAt) },
    { label: 'Возврат', value: formatMoment(endsAt) },
    { label: 'Маршрут', value: details.route },
    {
      label: 'Участники',
      value:
        details.participants.length > 0
          ? details.participants.map((person) => person.displayName).join(', ')
          : 'только вы',
    },
    { label: 'Договор', value: details.contract },
    { label: 'Цель', value: details.purpose },
    { label: 'Машина', value: car ? `${car.model} ${car.plate}` : '—' },
    {
      label: 'Водитель',
      value: details.needsDriver ? (driver?.fullName ?? '—') : 'без водителя, поеду сам',
    },
  ];

  return (
    <div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-fg-soft">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>

      {details.needsDriver && driver && !driver.telegramLinked && (
        <p className="mt-4 rounded-md border border-line bg-warn px-4 py-3 text-sm text-warn-fg">
          У водителя не подключён Telegram, и запрос подтверждения до него не дойдёт. Бронь
          всё равно создастся — попросите АХО подключить водителя в разделе «Водители».
        </p>
      )}

      <p className="mt-4 text-xs text-fg-soft">
        При отправке машина и водитель проверяются заново: за время заполнения их могли занять.
      </p>

      <div className="mt-6 flex justify-between gap-2">
        <button type="button" onClick={onBack} disabled={pending} className={BUTTON_GHOST}>
          ← Назад
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          className={BUTTON_PRIMARY}
        >
          {pending ? 'Отправляю…' : 'Отправить'}
        </button>
      </div>
    </div>
  );
}
