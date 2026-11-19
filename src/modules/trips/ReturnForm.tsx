'use client';

import { useState } from 'react';

import { BUTTON_GHOST, BUTTON_PRIMARY, FIELD } from '@/components/controls';

import type { FormEvent } from 'react';
import type { ReturnFormInput } from './actions';

interface ReturnFormProps {
  /** Начальное показание: подсказка, чтобы человек не перепутал цифры. */
  odometerStartKm: number | null;
  /**
   * Уже отправленный возврат. Задан — значит человек исправляет свои же
   * цифры: по требованиям до закрытия поездки это разрешено.
   */
  current?: {
    odometerKm: number | null;
    conditionOk: boolean | null;
    note: string | null;
  };
  pending: boolean;
  onSubmit: (input: ReturnFormInput) => void;
  onCancel: () => void;
}

/**
 * Оформление возврата: одометр, состояние, примечание.
 *
 * Порядок как в требованиях к К8 и Т5: сначала показание, потом «всё ли в
 * порядке», потом примечание. Примечание необязательно, но его просят у всех —
 * забытые вещи находятся чаще, чем поломки.
 */
export function ReturnForm({
  odometerStartKm,
  current,
  pending,
  onSubmit,
  onCancel,
}: ReturnFormProps) {
  const correcting = current?.odometerKm != null;

  const [odometer, setOdometer] = useState(
    current?.odometerKm != null ? String(current.odometerKm) : '',
  );
  const [conditionOk, setConditionOk] = useState(current?.conditionOk ?? true);
  const [note, setNote] = useState(current?.note ?? '');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      // Пустое поле — не ноль: иначе поездка закрылась бы с нулевым пробегом.
      odometerKm: odometer === '' ? Number.NaN : Number(odometer),
      conditionOk,
      note,
    });
  }

  const label = 'mb-1 block text-xs font-medium text-fg-soft';
  const distance =
    odometerStartKm !== null && odometer !== '' ? Number(odometer) - odometerStartKm : null;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
      <p className="mb-3 text-sm font-medium">
        {correcting ? 'Исправить показание' : 'Оформить возврат'}
      </p>

      {correcting && (
        <p className="mb-3 text-xs text-fg-soft">
          Исправить можно, пока рецепция не приняла ключи. Прежнее значение останется в истории
          показаний.
        </p>
      )}

      <label className="block">
        <span className={label}>Показание одометра, км</span>
        <input
          className={FIELD}
          value={odometer}
          onChange={(event) => setOdometer(event.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          placeholder={odometerStartKm !== null ? String(odometerStartKm) : '85136'}
          autoFocus
        />
      </label>

      <p className="mt-1 text-xs text-fg-soft">
        {odometerStartKm !== null ? (
          <>
            При выдаче было {odometerStartKm.toLocaleString('ru-RU')} км
            {distance !== null && distance >= 0 && (
              <> · пробег получится {distance.toLocaleString('ru-RU')} км</>
            )}
            {distance !== null && distance < 0 && (
              <span className="text-bad-fg"> · это меньше начального, проверьте цифры</span>
            )}
          </>
        ) : (
          'Начальное показание неизвестно — обратитесь в АХО.'
        )}
      </p>

      <fieldset className="mt-4">
        <legend className={label}>Всё в порядке с машиной?</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="condition"
              checked={conditionOk}
              onChange={() => setConditionOk(true)}
              className="accent-brand"
            />
            да
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="condition"
              checked={!conditionOk}
              onChange={() => setConditionOk(false)}
              className="accent-brand"
            />
            есть замечание
          </label>
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className={label}>
          {conditionOk ? 'Примечание' : 'Что с машиной'}
        </span>
        <input
          className={FIELD}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            conditionOk ? 'мусор, забытые вещи — необязательно' : 'спускает заднее колесо'
          }
        />
      </label>

      <p className="mt-1 text-xs text-fg-soft">
        {conditionOk
          ? 'Если нашли чужие вещи или мусор — напишите, АХО увидит.'
          : 'Замечание уйдёт в АХО, она решит, отправлять ли машину в ремонт.'}
      </p>

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {correcting ? 'Сохранить' : 'Отправить'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={BUTTON_GHOST}>
          Отмена
        </button>
      </div>

      {!correcting && (
        <p className="mt-3 text-xs text-fg-soft">
          После отправки сдайте ключи на рецепции — поездка закроется, когда их примут.
        </p>
      )}
    </form>
  );
}
