import { serverEnv } from '@/config/env';
import { sendTelegramMessage } from '@/lib/bots/telegram';
import { replyToDriver } from '@/modules/drivers/telegram';

import type { TelegramSender } from '@/modules/drivers/telegram';

/**
 * Вебхук Telegram-бота водителей. Telegram возвращает секрет в заголовке —
 * это единственная защита адреса, поэтому проверяется до разбора тела.
 *
 * Вся логика ответа — в `replyToDriver`. Сейчас это только привязка по коду;
 * диалоги возврата (Т5) придут в И6, и тогда здесь появится grammy.
 */
export async function POST(request: Request) {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== serverEnv.telegramWebhookSecret) {
    return new Response(null, { status: 401 });
  }

  const update = (await request.json()) as {
    message?: {
      chat: { id: number; type?: string };
      text?: string;
      from?: { username?: string; first_name?: string; last_name?: string };
    };
  };

  const message = update.message;
  if (!message?.text) {
    return new Response(null, { status: 200 });
  }

  const sender: TelegramSender = {
    chatId: message.chat.id,
    // Тип чата отсутствует только в неизвестном нам виде обновления — тогда
    // считаем чат групповым и привязку не делаем.
    isPrivate: message.chat.type === 'private',
    username: message.from?.username ?? null,
    displayName:
      [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || null,
  };

  try {
    await sendTelegramMessage(sender.chatId, await replyToDriver(sender, message.text));
  } catch (error) {
    // Отвечаем 200: при ошибке Telegram повторяет доставку того же обновления,
    // и водитель получил бы несколько одинаковых сообщений.
    console.error('Telegram-бот: не удалось ответить', error);
  }

  return new Response(null, { status: 200 });
}
