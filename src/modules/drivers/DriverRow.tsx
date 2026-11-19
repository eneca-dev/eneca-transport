'use client';

import { Send } from 'lucide-react';

import { BADGE, BADGE_DOT, BUTTON_SECONDARY } from '@/components/controls';
import { formatDay, formatMoment } from '@/lib/datetime';

import type { Driver, DriverUnavailability } from './queries';

interface DriverRowProps {
  driver: Driver;
  pending: boolean;
  onEdit: () => void;
  onIssueCode: () => void;
  onAddPeriod: () => void;
  onEditPeriod: (period: DriverUnavailability) => void;
}

const REASON_LABEL: Record<DriverUnavailability['reason'], string> = {
  sick: 'болезнь',
  vacation: 'отпуск',
  other: 'другое',
};

/** «04.11 – 06.11, болезнь» — так период выглядит в требованиях к Э9. */
function periodLabel(period: DriverUnavailability): string {
  const since = formatDay(new Date(period.since));
  const until = formatDay(new Date(period.until));
  const range = since === until ? since : `${since} – ${until}`;
  return `${range}, ${REASON_LABEL[period.reason]}`;
}

/**
 * Кто подключился в Telegram. Показывается рядом с отметкой, чтобы АХО видела:
 * код ввёл водитель, а не тот, кому он случайно попал.
 */
function telegramWho(driver: Driver): string | null {
  if (driver.telegramUsername) {
    return `@${driver.telegramUsername}`;
  }
  return driver.telegramDisplayName;
}

export function DriverRow({
  driver,
  pending,
  onEdit,
  onIssueCode,
  onAddPeriod,
  onEditPeriod,
}: DriverRowProps) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{driver.fullName}</span>
            {driver.phone && <span className="text-sm text-fg-soft">{driver.phone}</span>}
            {driver.telegramLinked ? (
              <span className={`${BADGE} bg-ok text-ok-fg`}>
                <span className={BADGE_DOT} aria-hidden />
                Telegram: подключён
              </span>
            ) : (
              <span className={`${BADGE} bg-bad text-bad-fg`}>
                <span className={BADGE_DOT} aria-hidden />
                Telegram: не подключён
              </span>
            )}
            {driver.telegramLinked && telegramWho(driver) && (
              <span className="text-xs text-fg-soft">{telegramWho(driver)}</span>
            )}
          </div>

          <p className="mt-0.5 text-sm text-fg-soft">
            {driver.unavailability.length === 0 ? (
              'Недоступен: —'
            ) : (
              <>
                Недоступен:{' '}
                {driver.unavailability.map((period, index) => (
                  <span key={period.id}>
                    {index > 0 && '; '}
                    <button
                      type="button"
                      onClick={() => onEditPeriod(period)}
                      disabled={pending}
                      className="underline decoration-dotted underline-offset-2 hover:text-fg disabled:opacity-50"
                    >
                      {periodLabel(period)}
                    </button>
                  </span>
                ))}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onIssueCode}
            disabled={pending}
            className={BUTTON_SECONDARY}
          >
            Выдать код
          </button>
          <button type="button" onClick={onAddPeriod} disabled={pending} className={BUTTON_SECONDARY}>
            Отметить период
          </button>
          <button type="button" onClick={onEdit} disabled={pending} className={BUTTON_SECONDARY}>
            Изменить
          </button>
        </div>
      </div>

      {/* Код показывается до тех пор, пока водитель его не введёт: АХО может
          закрыть вкладку, вернуться и продиктовать его снова. */}
      {driver.activeCode && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-soft px-3 py-2 text-sm">
          <Send className="size-4 shrink-0 text-fg-soft" aria-hidden />
          <span className="text-fg-soft">Код для водителя:</span>
          <span className="font-mono text-base font-semibold tracking-widest">
            {driver.activeCode.code}
          </span>
          <span className="text-fg-soft">
            действует до {formatMoment(new Date(driver.activeCode.expiresAt))}
          </span>
        </p>
      )}
    </li>
  );
}
