import 'server-only';

import { getDb } from '@/config/supabase';

import { notifyDocsReady } from './notify';

/**
 * Отметка «Документы готовы».
 *
 * Отдельно от Server Action, потому что то же самое делает кнопка в карточке
 * К3: нажатие приходит в вебхук бота, где токена вкладки нет, а сотрудник уже
 * определён. Держать это в двух местах значит однажды поправить одно и забыть
 * другое.
 */

export type DocsReadyOutcome =
  | { ok: true }
  | { ok: false; reason: string };

export async function setDocsReady(
  tripId: number,
  employeeId: string,
): Promise<DocsReadyOutcome> {
  const db = getDb();
  const now = new Date().toISOString();

  // Статус меняется только у заявки, которая ещё не выехала: после выдачи
  // ключей отметка документов уже ничего не меняет.
  const { data: updated, error } = await db
    .from('trips')
    .update({
      status: 'docs_ready',
      docs_ready_at: now,
      docs_ready_by: employeeId,
      docs_recheck_required: false,
      updated_at: now,
    })
    .eq('id', tripId)
    .in('status', ['booked', 'docs_ready'])
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось отметить документы`, error);
    return { ok: false, reason: 'Не получилось сохранить. Попробуйте ещё раз.' };
  }

  if ((updated ?? []).length === 0) {
    return {
      ok: false,
      reason: 'Заявка уже закрыта, отменена или в поездке — отметка ничего не изменит.',
    };
  }

  const { error: eventError } = await db.from('trip_events').insert({
    trip_id: tripId,
    kind: 'docs_ready',
    payload: {},
    actor_employee: employeeId,
  });

  if (eventError) {
    console.error(`Поездка #${tripId}: событие о документах не записано`, eventError);
  }

  await notifyDocsReady(tripId);

  return { ok: true };
}
