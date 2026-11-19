'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';

import { FIELD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';

import { searchParticipants } from './actions';

import type { EmployeeOption } from '@/modules/employees/queries';

interface ParticipantPickerProps {
  selected: EmployeeOption[];
  onChange: (people: EmployeeOption[]) => void;
}

/** Найденное вместе с запросом, которому оно принадлежит. */
interface Found {
  query: string;
  items: EmployeeOption[];
}

const EMPTY: Found = { query: '', items: [] };

/**
 * Выбор участников поездки.
 *
 * Поиском, а не списком: в справочнике больше девятисот человек. Запрос уходит
 * после паузы в наборе — иначе на каждую букву шёл бы вызов сервера.
 *
 * Результат хранится вместе с запросом, по которому получен, и показывается
 * только если запрос всё ещё тот же. Так не нужно гасить прежние совпадения
 * из эффекта, и в поле никогда не висят ответы на старый запрос.
 */
export function ParticipantPicker({ selected, onChange }: ParticipantPickerProps) {
  const { getToken } = useTeamsAuth();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const search = useCallback(
    (text: string) => {
      startTransition(async () => {
        try {
          const result = await searchParticipants(await getToken(), text);
          if (result.success) {
            setFound({ query: text, items: result.data });
            setError(null);
          } else {
            setError(result.error);
          }
        } catch {
          setError('Не удалось связаться с сервером.');
        }
      });
    },
    [getToken],
  );

  const text = query.trim();

  useEffect(() => {
    if (text.length < 2) {
      return;
    }
    const timer = setTimeout(() => search(text), 300);
    return () => clearTimeout(timer);
  }, [text, search]);

  function add(person: EmployeeOption) {
    if (!selected.some((chosen) => chosen.id === person.id)) {
      onChange([...selected, person]);
    }
    setQuery('');
    setFound(EMPTY);
    setOpen(false);
  }

  function close() {
    setOpen(false);
    setQuery('');
    setFound(EMPTY);
    setError(null);
  }

  const items = found.query === text ? found.items : [];
  const available = items.filter((person) => !selected.some((chosen) => chosen.id === person.id));
  const searching = pending || (text.length >= 2 && found.query !== text);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((person) => (
          <span
            key={person.id}
            className="inline-flex items-center gap-1 rounded-full bg-surface-soft px-2.5 py-1 text-sm"
          >
            {person.displayName}
            <button
              type="button"
              onClick={() => onChange(selected.filter((chosen) => chosen.id !== person.id))}
              aria-label={`Убрать ${person.displayName}`}
              className="text-fg-soft transition-colors hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}

        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-sm text-fg-soft transition-colors hover:text-fg"
          >
            <Plus className="size-3.5" aria-hidden />
            добавить
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2">
          <input
            className={FIELD}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Фамилия или имя"
            autoFocus
          />

          {error && <p className="mt-1 text-xs text-bad-fg">{error}</p>}

          {text.length > 0 && text.length < 2 && (
            <p className="mt-1 text-xs text-fg-soft">Введите хотя бы две буквы.</p>
          )}

          {searching && !error && <p className="mt-1 text-xs text-fg-soft">Ищу…</p>}

          {!searching && !error && text.length >= 2 && available.length === 0 && (
            <p className="mt-1 text-xs text-fg-soft">Никого не нашлось.</p>
          )}

          {available.length > 0 && (
            <ul className="mt-1 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
              {available.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => add(person)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-surface-soft"
                  >
                    <span className="text-sm">{person.displayName}</span>
                    {(person.department ?? person.jobTitle) && (
                      <span className="text-xs text-fg-soft">
                        {[person.jobTitle, person.department].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={close}
            className="mt-2 text-xs text-fg-soft underline underline-offset-2"
          >
            Закрыть поиск
          </button>
        </div>
      )}
    </div>
  );
}
