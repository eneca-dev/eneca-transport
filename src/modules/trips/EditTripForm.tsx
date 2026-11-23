'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import { ParticipantPicker } from './ParticipantPicker';

import type { FormEvent } from 'react';
import type { EmployeeOption } from '@/modules/employees/queries';
import type { EditFormInput } from './actions';
import type { TripCard } from './queries';

interface EditTripFormProps {
  trip: TripCard;
  pending: boolean;
  onSubmit: (input: EditFormInput) => void;
  onCancel: () => void;
}

/**
 * Правка заявки: маршрут, участники, договор, цель.
 *
 * Даты меняются «Перенести», машина — «Сменить машину», водитель —
 * «Назначить водителя». Разделено не для красоты: у каждого из них своя
 * проверка занятости, и мешать их в одну форму значит проверять всё сразу
 * даже когда человек поправил опечатку в цели.
 */
export function EditTripForm({ trip, pending, onSubmit, onCancel }: EditTripFormProps) {
  const [route, setRoute] = useState(trip.route);
  const [contract, setContract] = useState(trip.contract);
  const [purpose, setPurpose] = useState(trip.purpose);
  const [participants, setParticipants] = useState<EmployeeOption[]>(
    trip.participants.map((person) => ({
      id: person.employeeId,
      displayName: person.displayName,
      department: null,
      jobTitle: null,
    })),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      route,
      contract,
      purpose,
      participantIds: participants.map((person) => person.id),
    });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">Изменить заявку</p>

      <label className="block">
        <span className={label}>Маршрут</span>
        <input
          className={FIELD}
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          autoFocus
        />
      </label>

      <div className="mt-3">
        <span className={label}>Участники</span>
        <ParticipantPicker selected={participants} onChange={setParticipants} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Договор</span>
          <input
            className={FIELD}
            value={contract}
            onChange={(event) => setContract(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>Цель</span>
          <input
            className={FIELD}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
      </div>

      <ul className="mt-3 list-inside list-disc text-xs text-fg-soft">
        <li>Документы уйдут на повторную проверку в финотдел.</li>
        <li>Автор, участники, рецепция и финотдел получат уведомление с тем, что изменилось.</li>
        <li>Даты меняются кнопкой «Перенести», машина — «Сменить машину».</li>
      </ul>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          Сохранить
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>
    </form>
  );
}
