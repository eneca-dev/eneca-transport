import 'server-only';

import { serverEnv } from '@/config/env';

/** Отправить сообщение в Telegram. */
export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${serverEnv.telegramBotToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    // Текст ошибки Telegram полезен в логах: чаще всего это 403 от водителя,
    // который заблокировал бота.
    throw new Error(`Telegram отклонил сообщение: ${response.status} ${await response.text()}`);
  }
}
