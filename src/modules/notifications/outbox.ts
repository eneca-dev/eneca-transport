import 'server-only';

import { getDb } from '@/config/supabase';

/**
 * Журнал исходящих сообщений.
 *
 * Ключ занимается ДО отправки, а не после. Разница существенная: карточку по
 * событию (бронь создана) можно отправить и потом записать — событие одно.
 * Карточку по сроку планировщик встретит в каждом проходе, то есть каждую
 * минуту, и если ключ занять после отправки, автор получит её шестьдесят раз
 * в час. Поэтому порядок один для всех: занять ключ, отправить, отметить.
 *
 * Занятый ключ — это уникальный индекс на `notifications.dedupe_key`. Второй
 * проход получает отказ базы и ничего не отправляет.
 */

export type Channel = 'teams' | 'telegram';

export type Recipient = { employeeId: string } | { driverId: string };

export interface OutboxEntry {
  /** 'K1'…'K16', 'T1'…'T6'. */
  template: string;
  channel: Channel;
  tripId: number;
  recipient: Recipient;
  /** Например «K16:trip:127». Уникален на всю таблицу. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
}

/**
 * Занять ключ. Возвращает номер записи или `null`, если такое сообщение уже
 * отправляли или отправляют.
 */
export async function claim(entry: OutboxEntry): Promise<number | null> {
  const { data, error } = await getDb()
    .from('notifications')
    .insert({
      template: entry.template,
      channel: entry.channel,
      trip_id: entry.tripId,
      recipient_employee: 'employeeId' in entry.recipient ? entry.recipient.employeeId : null,
      recipient_driver: 'driverId' in entry.recipient ? entry.recipient.driverId : null,
      payload: entry.payload ?? {},
      send_after: new Date().toISOString(),
      dedupe_key: entry.dedupeKey,
    })
    .select('id')
    .returns<{ id: number }[]>();

  if (error) {
    // 23505 — ключ занят. Это и есть защита от повтора, а не сбой.
    if (error.code !== '23505') {
      console.error(`Не удалось занять ключ ${entry.dedupeKey}`, error);
    }
    return null;
  }

  return data[0].id;
}

export async function markSent(id: number, externalMessageId: string | number): Promise<void> {
  const { error } = await getDb()
    .from('notifications')
    .update({
      sent_at: new Date().toISOString(),
      attempts: 1,
      external_message_id: String(externalMessageId),
    })
    .eq('id', id);

  if (error) {
    console.error(`Не удалось отметить отправку ${id}`, error);
  }
}

export async function markFailed(id: number, reason: string): Promise<void> {
  const { error } = await getDb()
    .from('notifications')
    .update({ failed_at: new Date().toISOString(), attempts: 1, last_error: reason })
    .eq('id', id);

  if (error) {
    console.error(`Не удалось отметить отказ ${id}`, error);
  }
}

/**
 * Отправить один раз: занять ключ, отправить, отметить.
 *
 * Ошибку отправки не выбрасывает — причина остаётся в `last_error`. Вызывающий
 * код продолжает работу: недоставленное сообщение не повод отменять бронь.
 */
export async function deliverOnce(
  entry: OutboxEntry,
  send: () => Promise<string | number>,
): Promise<void> {
  const id = await claim(entry);

  if (id === null) {
    return;
  }

  try {
    await markSent(id, await send());
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error(`${entry.template} (${entry.dedupeKey}) не отправлено: ${reason}`);
    await markFailed(id, reason);
  }
}

/** Отметить отправку, которая невозможна: получателю некуда писать. */
export async function skipDelivery(entry: OutboxEntry, reason: string): Promise<void> {
  const id = await claim(entry);
  if (id !== null) {
    await markFailed(id, reason);
  }
}
