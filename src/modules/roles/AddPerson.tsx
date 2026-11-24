'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { FIELD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';

import { searchRoleCandidates } from './actions';

import type { EmployeeOption } from '@/modules/employees/queries';

/**
 * Поиск сотрудника, которому выдать роль.
 *
 * Поиском, а не списком: в справочнике больше девятисот человек. Запрос уходит
 * после паузы в наборе, а найденное хранится вместе с запросом, по которому
 * получено, — иначе в поле висят ответы на прежний запрос.
 */

interface AddPersonProps {
  /** Кто уже в этой роли: предлагать его второй раз незачем. */
  exclude: string[];
  onPick: (employeeId: string) => void;
  disabled?: boolean;
}

interface Found {
  query: string;
  items: EmployeeOption[];
}

const EMPTY: Found = { query: '', items: [] };

export function AddPerson({ exclude, onPick, disabled }: AddPersonProps) {
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
          const result = await searchRoleCandidates(await getToken(), text);
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

  function close() {
    setOpen(false);
    setQuery('');
    setFound(EMPTY);
    setError(null);
  }

  function pick(employeeId: string) {
    onPick(employeeId);
    close();
  }

  const items = found.query === text ? found.items : [];
  const available = items.filter((person) => !exclude.includes(person.id));
  const searching = pending || (text.length >= 2 && found.query !== text);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-sm text-fg-soft transition-colors hover:text-fg disabled:opacity-50"
      >
        <Plus className="size-3.5" aria-hidden />
        добавить
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm">
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
                onClick={() => pick(person.id)}
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
  );
}
