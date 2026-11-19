'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { BUTTON_PRIMARY_SM } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { TELEGRAM_BOT_LINK } from '@/config/app';

import {
  addUnavailability,
  createDriver,
  deleteDriver,
  deleteUnavailability,
  issueLinkCode,
  loadDrivers,
  updateDriver,
  updateUnavailability,
} from './actions';
import { DriverForm } from './DriverForm';
import { DriverRow } from './DriverRow';
import { UnavailabilityForm } from './UnavailabilityForm';

import type { ActionResult } from '@/lib/types';
import type { DriverInput, UnavailabilityInput } from './actions';
import type { Driver, DriverUnavailability } from './queries';

/** Какая форма раскрыта под строкой водителя. */
type OpenForm =
  | { kind: 'driver'; driver: Driver }
  | { kind: 'period'; driver: Driver; period?: DriverUnavailability };

/** Э9 «Водители». Справочник ведёт АХО. */
export function DriversScreen() {
  const { getToken } = useTeamsAuth();

  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<OpenForm | null>(null);
  const [pending, startTransition] = useTransition();

  /** Все действия возвращают новый список: экран не расходится с базой. */
  const run = useCallback(
    (action: (token: string) => Promise<ActionResult<Driver[]>>, onDone?: () => void) => {
      startTransition(async () => {
        try {
          const result = await action(await getToken());
          if (result.success) {
            setDrivers(result.data);
            setError(null);
            onDone?.();
          } else {
            setError(result.error);
          }
        } catch {
          setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
        }
      });
    },
    [getToken],
  );

  useEffect(() => {
    run((token) => loadDrivers(token));
  }, [run]);

  function close() {
    setAdding(false);
    setOpen(null);
  }

  function handleIssueCode(driver: Driver) {
    startTransition(async () => {
      try {
        const result = await issueLinkCode(await getToken(), driver.id);
        if (result.success) {
          setDrivers(result.data.drivers);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
      }
    });
  }

  function handlePeriod(target: OpenForm & { kind: 'period' }, input: UnavailabilityInput) {
    const action = target.period
      ? (token: string) => updateUnavailability(token, target.period!.id, input)
      : (token: string) => addUnavailability(token, target.driver.id, input);
    run(action, close);
  }

  function handleDriver(driver: Driver, input: DriverInput) {
    run((token) => updateDriver(token, driver.id, input), close);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Водители</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              close();
              setAdding(true);
            }}
            className={BUTTON_PRIMARY_SM}
          >
            <Plus className="size-4" aria-hidden />
            Добавить
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-fg-soft">
        Водитель подключается сам: откройте ему{' '}
        <a
          href={TELEGRAM_BOT_LINK}
          target="_blank"
          rel="noreferrer"
          className="text-brand-text underline underline-offset-2"
        >
          бота в Telegram
        </a>{' '}
        и продиктуйте код из кнопки «Выдать код». Код действует сутки и вводится один раз.
      </p>

      {error && (
        <p className="mb-4 rounded-md border border-bad-line bg-bad px-4 py-3 text-sm text-bad-fg">
          {error}
        </p>
      )}

      {adding && (
        <div className="mb-4">
          <DriverForm
            pending={pending}
            onSubmit={(input) => run((token) => createDriver(token, input), close)}
            onCancel={close}
          />
        </div>
      )}

      {drivers === null && !error && <p className="text-sm text-fg-soft">Загрузка…</p>}

      {drivers?.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-fg-soft">
          Справочник пуст. Добавьте водителя — нужны фамилия с именем и телефон.
        </p>
      )}

      {drivers && drivers.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {drivers.map((driver) => {
            if (open?.driver.id === driver.id && open.kind === 'driver') {
              return (
                <li key={driver.id} className="p-4">
                  <DriverForm
                    driver={driver}
                    pending={pending}
                    onSubmit={(input) => handleDriver(driver, input)}
                    onDelete={() => run((token) => deleteDriver(token, driver.id), close)}
                    onCancel={close}
                  />
                </li>
              );
            }

            if (open?.driver.id === driver.id && open.kind === 'period') {
              return (
                <li key={driver.id} className="p-4">
                  <UnavailabilityForm
                    driver={driver}
                    period={open.period}
                    pending={pending}
                    onSubmit={(input) => handlePeriod(open, input)}
                    onDelete={
                      open.period
                        ? () =>
                            run(
                              (token) => deleteUnavailability(token, open.period!.id),
                              close,
                            )
                        : undefined
                    }
                    onCancel={close}
                  />
                </li>
              );
            }

            return (
              <DriverRow
                key={driver.id}
                driver={driver}
                pending={pending}
                onEdit={() => {
                  close();
                  setOpen({ kind: 'driver', driver });
                }}
                onIssueCode={() => handleIssueCode(driver)}
                onAddPeriod={() => {
                  close();
                  setOpen({ kind: 'period', driver });
                }}
                onEditPeriod={(period) => {
                  close();
                  setOpen({ kind: 'period', driver, period });
                }}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
