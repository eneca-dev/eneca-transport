import { formatLateness } from '@/lib/datetime';

/**
 * Что именно изменилось — одной строкой.
 *
 * Подробности каждого изменения уже лежат в `trip_events.payload`. Здесь они
 * превращаются в текст, и это единственное место, где такое превращение
 * описано: иначе журнал в Э3, перечень в Э5 и карточка К3 рассказывали бы об
 * одном событии по-разному.
 */

export interface ChangeEvent {
  kind: string;
  payload: Record<string, unknown>;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

interface FieldChangeRow {
  field?: unknown;
  was?: unknown;
  became?: unknown;
}

/** Виды событий, которые означают изменение данных для документов. */
export const DOCUMENT_AFFECTING = [
  'rescheduled',
  'trip_edited',
  'car_changed',
  'driver_assigned',
  'driver_dropped',
  'driver_unassigned',
] as const;

/**
 * Изменение так, как его должен прочитать финотдел: что было и что стало.
 *
 * `null` — событие не меняет данных для документов.
 */
export function describeChange(event: ChangeEvent): string | null {
  const { kind, payload } = event;

  if (kind === 'rescheduled') {
    const was = str(payload, 'was');
    const became = str(payload, 'became');
    return was && became ? `Даты: было ${was}, стало ${became}` : 'Даты изменены';
  }

  if (kind === 'trip_edited') {
    const changes = payload.changes;
    if (!Array.isArray(changes)) {
      return 'Данные заявки изменены';
    }

    const lines = changes
      .map((change) => {
        const row = change as FieldChangeRow;
        if (typeof row.field !== 'string') {
          return null;
        }
        const was = typeof row.was === 'string' ? row.was : null;
        const became = typeof row.became === 'string' ? row.became : null;
        return was && became
          ? `${row.field}: было «${was}», стало «${became}»`
          : `${row.field} изменён`;
      })
      .filter((line): line is string => line !== null);

    return lines.length > 0 ? lines.join('; ') : 'Данные заявки изменены';
  }

  if (kind === 'car_changed') {
    const previous = str(payload, 'previous');
    const next = str(payload, 'next');
    if (!next) return 'Машина изменена';
    return previous ? `Машина: ${previous} → ${next}` : `Выбрана машина: ${next}`;
  }

  if (kind === 'driver_assigned') {
    const previous = str(payload, 'previous');
    const next = str(payload, 'next');
    if (!next) return 'Водитель изменён';
    return previous ? `Водитель: ${previous} → ${next}` : `Назначен водитель: ${next}`;
  }

  if (kind === 'driver_dropped') {
    return 'Водитель снят, поедет автор';
  }

  if (kind === 'driver_unassigned') {
    const reason = str(payload, 'reason');
    return reason ? `Водитель снят: ${reason}` : 'Водитель снят';
  }

  return null;
}

/**
 * Подробности для журнала в Э3.
 *
 * Отличается от перечня для финотдела: там нужно «что стало с документами», а
 * здесь — короткая приписка к уже названному событию.
 */
export function describeForJournal(event: ChangeEvent): string | null {
  const { kind, payload } = event;

  if (kind === 'keys_issued') {
    const start = num(payload, 'odometer_start_km');
    return start !== null ? `одометр ${start.toLocaleString('ru-RU')} км` : null;
  }

  if (kind === 'return_submitted') {
    const end = num(payload, 'odometer_end_km');
    const parts: string[] = [];
    if (end !== null) parts.push(`${end.toLocaleString('ru-RU')} км`);
    if (payload.condition_ok === false) parts.push('есть замечание');
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (kind === 'odometer_corrected') {
    const was = num(payload, 'previous_value_km');
    const became = num(payload, 'value_km');
    const reason = str(payload, 'reason');
    const change =
      was !== null && became !== null
        ? `было ${was.toLocaleString('ru-RU')}, стало ${became.toLocaleString('ru-RU')} км`
        : null;
    return [change, reason].filter(Boolean).join(' · ') || null;
  }

  if (kind === 'driver_confirmed_by_aho') {
    const driver = str(payload, 'driver');
    return driver ? `за водителя ${driver}` : null;
  }

  if (kind === 'closed') {
    const end = num(payload, 'odometer_end_km');
    const lateBy = num(payload, 'late_by_minutes');
    const parts: string[] = [];

    if (end !== null) {
      parts.push(`одометр ${end.toLocaleString('ru-RU')} км`);
    }
    // Просрочка названа прямо: через месяц из одного времени закрытия не
    // видно, что машину не сдавали двое суток.
    if (lateBy !== null && lateBy > 0) {
      parts.push(`с просрочкой ${formatLateness(lateBy)}`);
    }

    return parts.length > 0 ? parts.join(' · ') : null;
  }

  // Остальное описывается так же, как для финотдела: «было → стало».
  return describeChange(event);
}
