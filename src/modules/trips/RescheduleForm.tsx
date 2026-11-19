'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import { toMinskDate } from './booking';

import type { FormEvent } from 'react';
import type { RescheduleFormInput } from './actions';

interface RescheduleFormProps {
  startsAt: string;
  endsAt: string;
  hasDriver: boolean;
  pending: boolean;
  onSubmit: (input: RescheduleFormInput) => void;
  onCancel: () => void;
}

/** Время в поле ввода — минское, как и везде в приложении. */
function minskTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function RescheduleForm({
  startsAt,
  endsAt,
  hasDriver,
  pending,
  onSubmit,
  onCancel,
}: RescheduleFormProps) {
  const [startDate, setStartDate] = useState(toMinskDate(new Date(startsAt)));
  const [startTime, setStartTime] = useState(minskTime(startsAt));
  const [endDate, setEndDate] = useState(toMinskDate(new Date(endsAt)));
  const [endTime, setEndTime] = useState(minskTime(endsAt));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ startDate, startTime, endDate, endTime });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">Перенести поездку</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className={label}>Выезд</legend>
          <div className="flex gap-2">
            <input
              type="date"
              className={FIELD}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-label="Дата выезда"
            />
            <input
              type="time"
              className={FIELD}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              aria-label="Время выезда"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Возврат</legend>
          <div className="flex gap-2">
            <input
              type="date"
              className={FIELD}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-label="Дата возврата"
            />
            <input
              type="time"
              className={FIELD}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-label="Время возврата"
            />
          </div>
        </fieldset>
      </div>

      {/* Последствия переноса называются заранее: человек должен понимать, что
          документы придётся готовить заново, а водителя — спрашивать снова. */}
      <ul className="mt-3 list-inside list-disc text-xs text-fg-soft">
        <li>Машина и водитель проверяются на новое время заново.</li>
        <li>Документы уйдут на повторную проверку в финотдел.</li>
        {hasDriver && <li>Водителю придёт новый запрос подтверждения.</li>}
        <li>Автор, участники, рецепция и финотдел получат уведомление.</li>
      </ul>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          Перенести
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </form>
  );
}
