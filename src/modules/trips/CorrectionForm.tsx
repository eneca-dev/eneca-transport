'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { CorrectionFormInput } from './actions';

interface CorrectionFormProps {
  odometerStartKm: number | null;
  odometerEndKm: number;
  pending: boolean;
  onSubmit: (input: CorrectionFormInput) => void;
  onCancel: () => void;
}

/**
 * Исправление показания у закрытой поездки.
 *
 * Причина обязательна: прежнее значение остаётся в истории, и без причины
 * через месяц непонятно, почему пробег в отчёте не сходится с одометром.
 */
export function CorrectionForm({
  odometerStartKm,
  odometerEndKm,
  pending,
  onSubmit,
  onCancel,
}: CorrectionFormProps) {
  const [value, setValue] = useState(String(odometerEndKm));
  const [reason, setReason] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      valueKm: value === '' ? Number.NaN : Number(value),
      reason,
    });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';
  const distance =
    odometerStartKm !== null && value !== '' ? Number(value) - odometerStartKm : null;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">Исправить показание</p>
      <p className="mb-3 text-xs text-fg-soft">
        Прежнее значение останется в истории показаний вместе с причиной и вашим именем. Показания
        последующих поездок не изменятся — если они тоже неверны, исправьте каждую.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Показание при сдаче, км</span>
          <input
            className={FIELD}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoFocus
          />
        </label>
        <label className="block">
          <span className={label}>Причина исправления</span>
          <input
            className={FIELD}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="водитель перепутал цифры"
          />
        </label>
      </div>

      <p className="mt-1 text-xs text-fg-soft">
        Было {odometerEndKm.toLocaleString('ru-RU')} км
        {odometerStartKm !== null && <> · при выдаче {odometerStartKm.toLocaleString('ru-RU')} км</>}
        {distance !== null && distance >= 0 && (
          <> · пробег станет {distance.toLocaleString('ru-RU')} км</>
        )}
        {distance !== null && distance < 0 && (
          <span className="text-bad-fg"> · это меньше начального</span>
        )}
      </p>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          Исправить
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </form>
  );
}
