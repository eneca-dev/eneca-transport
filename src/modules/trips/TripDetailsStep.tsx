'use client';

import { BUTTON_PRIMARY, FIELD } from '@/components/controls';

import { ParticipantPicker } from './ParticipantPicker';

import type { FormEvent } from 'react';
import type { EmployeeOption } from '@/modules/employees/queries';

/** Что человек заполняет на первом шаге Э2. */
export interface TripDetails {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  route: string;
  contract: string;
  purpose: string;
  participants: EmployeeOption[];
  needsDriver: boolean;
}

interface TripDetailsStepProps {
  value: TripDetails;
  pending: boolean;
  onChange: (details: TripDetails) => void;
  onNext: () => void;
}

const LABEL = 'mb-1 block text-xs font-medium text-fg-soft';

export function TripDetailsStep({ value, pending, onChange, onNext }: TripDetailsStepProps) {
  function set<K extends keyof TripDetails>(key: K, next: TripDetails[K]) {
    onChange({ ...value, [key]: next });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className={LABEL}>Выезд</legend>
          <div className="flex gap-2">
            <input
              type="date"
              className={FIELD}
              value={value.startDate}
              onChange={(event) => set('startDate', event.target.value)}
              aria-label="Дата выезда"
            />
            <input
              type="time"
              className={FIELD}
              value={value.startTime}
              onChange={(event) => set('startTime', event.target.value)}
              aria-label="Время выезда"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className={LABEL}>Возврат</legend>
          <div className="flex gap-2">
            <input
              type="date"
              className={FIELD}
              value={value.endDate}
              onChange={(event) => set('endDate', event.target.value)}
              aria-label="Дата возврата"
            />
            <input
              type="time"
              className={FIELD}
              value={value.endTime}
              onChange={(event) => set('endTime', event.target.value)}
              aria-label="Время возврата"
            />
          </div>
        </fieldset>
      </div>

      <label className="mt-4 block">
        <span className={LABEL}>Маршрут</span>
        <input
          className={FIELD}
          value={value.route}
          onChange={(event) => set('route', event.target.value)}
          placeholder="Минск → Гомель → Минск"
        />
      </label>

      <div className="mt-4">
        <span className={LABEL}>Участники</span>
        <ParticipantPicker
          selected={value.participants}
          onChange={(people) => set('participants', people)}
        />
        <p className="mt-1 text-xs text-fg-soft">
          Вас добавлять не нужно — вы автор поездки. Участники получат уведомление и смогут
          открыть карточку.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Договор</span>
          <input
            className={FIELD}
            value={value.contract}
            onChange={(event) => set('contract', event.target.value)}
            placeholder="45/2026"
          />
        </label>
        <label className="block">
          <span className={LABEL}>Цель</span>
          <input
            className={FIELD}
            value={value.purpose}
            onChange={(event) => set('purpose', event.target.value)}
            placeholder="Авторский надзор на объекте"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className={LABEL}>Нужен водитель</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="needsDriver"
              checked={value.needsDriver}
              onChange={() => set('needsDriver', true)}
              className="accent-brand"
            />
            да
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="needsDriver"
              checked={!value.needsDriver}
              onChange={() => set('needsDriver', false)}
              className="accent-brand"
            />
            нет, поеду сам
          </label>
        </div>
      </fieldset>

      <div className="mt-6 flex justify-end">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          Далее →
        </button>
      </div>
    </form>
  );
}
