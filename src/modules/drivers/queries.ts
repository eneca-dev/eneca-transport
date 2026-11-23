import 'server-only';

import { getDb } from '@/config/supabase';

export type UnavailabilityReason = 'sick' | 'vacation' | 'other';

export interface DriverUnavailability {
  id: string;
  /** Дата в формате YYYY-MM-DD: в базе это `date`, без времени и зоны. */
  since: string;
  until: string;
  reason: UnavailabilityReason;
  note: string | null;
}

/** Выданный код привязки Telegram, пока он не использован и не истёк. */
export interface DriverLinkCode {
  code: string;
  expiresAt: string;
}

export interface Driver {
  id: string;
  fullName: string;
  phone: string | null;
  /** Привязан ли Telegram. Сам chat_id в браузер не отдаётся. */
  telegramLinked: boolean;
  telegramLinkedAt: string | null;
  /** Как подключившийся представлен в Telegram — АХО сверяет глазами. */
  telegramUsername: string | null;
  telegramDisplayName: string | null;
  isActive: boolean;
  /** Периоды недоступности, которые ещё не закончились. */
  unavailability: DriverUnavailability[];
  activeCode: DriverLinkCode | null;
}

interface DriverRow {
  id: string;
  full_name: string;
  phone: string | null;
  telegram_linked: boolean;
  telegram_linked_at: string | null;
  telegram_username: string | null;
  telegram_display_name: string | null;
  is_active: boolean;
}

interface UnavailabilityRow {
  id: string;
  driver_id: string;
  since: string;
  until: string;
  reason: UnavailabilityReason;
  note: string | null;
}

interface LinkCodeRow {
  code: string;
  driver_id: string;
  expires_at: string;
}

/**
 * Справочник водителей для Э9.
 *
 * Периоды недоступности берутся отдельным запросом, а не из
 * `v_drivers.upcoming_unavailability`: в представлении нет идентификатора
 * периода, а Э9 даёт его править и сокращать, когда водитель вернулся раньше.
 */
export async function listDrivers(): Promise<Driver[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const { data: drivers, error } = await db
    .from('v_drivers')
    .select(
      'id, full_name, phone, telegram_linked, telegram_linked_at, ' +
        'telegram_username, telegram_display_name, is_active',
    )
    .order('full_name')
    .returns<DriverRow[]>();

  if (error) {
    throw new Error(`Не удалось прочитать водителей: ${error.message}`);
  }

  const { data: periods, error: periodsError } = await db
    .from('driver_unavailability')
    .select('id, driver_id, since, until, reason, note')
    .gte('until', today)
    .order('since')
    .returns<UnavailabilityRow[]>();

  if (periodsError) {
    throw new Error(`Не удалось прочитать периоды недоступности: ${periodsError.message}`);
  }

  const { data: codes, error: codesError } = await db
    .from('driver_link_codes')
    .select('code, driver_id, expires_at')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .returns<LinkCodeRow[]>();

  if (codesError) {
    throw new Error(`Не удалось прочитать коды привязки: ${codesError.message}`);
  }

  const byDriver = new Map<string, DriverUnavailability[]>();
  for (const period of periods ?? []) {
    const list = byDriver.get(period.driver_id) ?? [];
    list.push({
      id: period.id,
      since: period.since,
      until: period.until,
      reason: period.reason,
      note: period.note,
    });
    byDriver.set(period.driver_id, list);
  }

  // Запрос отсортирован от свежего к старому, поэтому первый код — последний
  // выданный. Остальные АХО уже заменила, показывать их незачем.
  const codeByDriver = new Map<string, DriverLinkCode>();
  for (const row of codes ?? []) {
    if (!codeByDriver.has(row.driver_id)) {
      codeByDriver.set(row.driver_id, { code: row.code, expiresAt: row.expires_at });
    }
  }

  return (drivers ?? []).map((driver) => ({
    id: driver.id,
    fullName: driver.full_name,
    phone: driver.phone,
    telegramLinked: driver.telegram_linked,
    telegramLinkedAt: driver.telegram_linked_at,
    telegramUsername: driver.telegram_username,
    telegramDisplayName: driver.telegram_display_name,
    isActive: driver.is_active,
    unavailability: byDriver.get(driver.id) ?? [],
    activeCode: codeByDriver.get(driver.id) ?? null,
  }));
}

/**
 * Водитель, привязанный к этому чату Telegram.
 *
 * Лежит здесь, а не рядом с привязкой: по чату водителя ищут и привязка, и
 * диалог возврата, и календарь. Если бы функция осталась в одном из них,
 * остальные ссылались бы друг на друга по кругу.
 */
export async function driverByChat(
  chatId: number,
): Promise<{ id: string; full_name: string } | null> {
  const { data, error } = await getDb()
    .from('drivers')
    .select('id, full_name')
    .eq('telegram_chat_id', chatId)
    .maybeSingle<{ id: string; full_name: string }>();

  if (error) {
    console.error('Не удалось найти водителя по чату', error);
    return null;
  }
  return data;
}

/**
 * Причины недоступности по-русски — одним набором на приложение.
 *
 * Нужны и в календаре АХО, и в календаре самого водителя. Два списка
 * разошлись бы: в одном месте «недоступен», в другом «другое».
 */
export const REASON_LABEL: Record<UnavailabilityReason, string> = {
  sick: 'болезнь',
  vacation: 'отпуск',
  other: 'недоступен',
};

/** Периоды недоступности водителя, которые задевают отрезок дат. */
export async function driverUnavailability(
  driverId: string,
  since: string,
  until: string,
): Promise<DriverUnavailability[]> {
  const { data, error } = await getDb()
    .from('driver_unavailability')
    .select('id, since, until, reason, note')
    .eq('driver_id', driverId)
    .lte('since', until)
    .gte('until', since)
    .order('since')
    .returns<DriverUnavailability[]>();

  if (error) {
    throw new Error(`Не удалось прочитать периоды недоступности: ${error.message}`);
  }

  return data ?? [];
}
