import { serverEnv } from '@/config/env';

/**
 * Вебхук Telegram-бота водителей. Telegram возвращает секрет в заголовке —
 * это единственная защита адреса, поэтому проверяется до разбора тела.
 * Пока только эхо для проверки связи (неделя 1 плана этапа 1).
 */
export async function POST(request: Request) {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== serverEnv.telegramWebhookSecret) {
    return new Response(null, { status: 401 });
  }

  const update = (await request.json()) as {
    message?: { chat: { id: number }; text?: string };
  };

  if (update.message?.text) {
    await fetch(`https://api.telegram.org/bot${serverEnv.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: update.message.chat.id,
        text: `Связь есть. Вы написали: «${update.message.text}»`,
      }),
    });
  }

  return new Response(null, { status: 200 });
}
