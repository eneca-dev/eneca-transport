import 'server-only';

import { getDb } from '@/config/supabase';
import { fetchDirectoryUsers } from '@/lib/graph/directoryUsers';

import type { DirectoryUser } from '@/lib/graph/directoryUsers';

/**
 * Синхронизация справочника сотрудников из Microsoft Graph в таблицу
 * `employees`. Источник истины — Entra ID, локальная копия нужна, чтобы не
 * ходить в Graph на каждый поиск участника поездки.
 *
 * Запускается по расписанию воркером на VPS через `/api/jobs/sync-employees`.
 */

/** Сколько строк отправляется в Supabase за один запрос. */
const CHUNK = 500;

export interface EmployeeSyncResult {
  /** Сколько учётных записей отдал Graph. */
  fetched: number;
  /** Сколько строк записано (вставлено или обновлено). */
  upserted: number;
  /** Сколько сотрудников помечены неактивными: их больше нет в каталоге. */
  deactivated: number;
}

interface EmployeeRow {
  entra_oid: string;
  upn: string;
  display_name: string;
  department: string | null;
  job_title: string | null;
  manager_entra_oid: string | null;
  is_active: boolean;
  synced_at: string;
}

function toRow(user: DirectoryUser, syncedAt: string): EmployeeRow | null {
  // Без oid строку не с чем связать: это ключ справочника.
  if (!user.id) {
    return null;
  }
  const upn = user.userPrincipalName ?? user.mail;
  return {
    entra_oid: user.id,
    upn: upn ?? user.id,
    // В каталоге встречаются записи без displayName — тогда виден хотя бы адрес.
    display_name: user.displayName?.trim() || (upn ?? user.id),
    department: user.department,
    job_title: user.jobTitle,
    manager_entra_oid: user.manager?.id ?? null,
    is_active: user.accountEnabled !== false,
    synced_at: syncedAt,
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function syncEmployees(): Promise<EmployeeSyncResult> {
  const db = getDb();
  const syncedAt = new Date().toISOString();

  const users = await fetchDirectoryUsers();
  const rows = users.map((user) => toRow(user, syncedAt)).filter((row) => row !== null);

  for (const chunk of chunked(rows, CHUNK)) {
    const { error } = await db.from('employees').upsert(chunk, { onConflict: 'entra_oid' });
    if (error) {
      throw new Error(`Не удалось записать сотрудников: ${error.message}`);
    }
  }

  // Учётную запись могли удалить из каталога целиком. Строку не удаляем —
  // на неё ссылаются закрытые поездки, — а помечаем неактивной.
  const { data: existing, error: readError } = await db
    .from('employees')
    .select('id, entra_oid')
    .eq('is_active', true);

  if (readError) {
    throw new Error(`Не удалось прочитать сотрудников: ${readError.message}`);
  }

  const seen = new Set(rows.map((row) => row.entra_oid));
  const vanished = (existing ?? [])
    .filter((row: { id: string; entra_oid: string }) => !seen.has(row.entra_oid))
    .map((row: { id: string }) => row.id);

  for (const chunk of chunked(vanished, CHUNK)) {
    const { error } = await db
      .from('employees')
      .update({ is_active: false, synced_at: syncedAt })
      .in('id', chunk);
    if (error) {
      throw new Error(`Не удалось пометить уволенных: ${error.message}`);
    }
  }

  return { fetched: users.length, upserted: rows.length, deactivated: vanished.length };
}
