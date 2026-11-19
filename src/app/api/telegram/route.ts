import { serverEnv } from '@/config/env';
import { sendTelegramMessage } from '@/lib/bots/telegram';
import { replyToDriver } from '@/modules/drivers/telegram';
import { handleDriverCallback } from '@/modules/trips/notifyDriver';

import type { TelegramSender } from '@/modules/drivers/telegram';

/**
 * Вебхук Telegram-бота водителей. Telegram возвращает секрет в заголовке —
 * это единственная защита адреса, поэтому проверяется до разбора тела.
 *
 * Два вида обновлений: текстовые сообщения (привязка по коду) и нажатия кнопок
 * под сообщением (`callback_query` — ответ на Т1).
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
    callback_query?: {
      id: string;
      data?: string;
      message?: { message_id: number; chat: { id: number } };
    };
  };

  try {
    const callback = update.callback_query;

    if (callback?.data && callback.message) {
      await handleDriverCallback({
        callbackId: callback.id,
        chatId: callback.message.chat.id,
        messageId: callback.message.message_id,
        data: callback.data,
      });
      return new Response(null, { status: 200 });
    }

    const message = update.message;

    if (message?.text) {
      const sender: TelegramSender = {
        chatId: message.chat.id,
        // Тип чата отсутствует только в неизвестном нам виде обновления — тогда
        // считаем чат групповым и привязку не делаем.
        isPrivate: message.chat.type === 'private',
        username: message.from?.username ?? null,
        displayName:
          [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || null,
      };

      const reply = await replyToDriver(sender, message.text);
      await sendTelegramMessage(sender.chatId, reply.text, {
        buttons: reply.buttons,
        withKeyboard: reply.withKeyboard,
      });
    }
  } catch (error) {
    // Отвечаем 200: при ошибке Telegram повторяет доставку того же обновления,
    // и водитель получил бы несколько одинаковых сообщений.
    console.error('Telegram-бот: не удалось обработать обновление', error);
  }

  return new Response(null, { status: 200 });
}
