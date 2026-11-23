import 'server-only';

import { serverEnv } from '@/config/env';

/**
 * Отправка в Telegram.
 *
 * Кнопки — inline-клавиатура: ответ приходит в вебхук как `callback_query`,
 * и после ответа кнопки убираются, чтобы на одно назначение нельзя было
 * ответить дважды.
 */

export interface InlineButton {
  text: string;
  /** До 64 байт — ограничение Telegram. Формат: «действие:номер поездки». */
  data: string;
}

async function callTelegram<T>(method: string, body: unknown): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${serverEnv.telegramBotToken}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );

  const text = await response.text();

  if (!response.ok) {
    // Текст ошибки Telegram полезен в журнале: чаще всего это 403 от того,
    // кто заблокировал бота.
    throw new Error(`Telegram ${method} → ${response.status} ${text}`);
  }

  const payload = JSON.parse(text) as { ok: boolean; result: T; description?: string };
  if (!payload.ok) {
    throw new Error(`Telegram ${method} отказал: ${payload.description ?? 'без причины'}`);
  }
  return payload.result;
}

/**
 * Постоянные кнопки под полем ввода. Требование к боту водителя: «Мои поездки»
 * доступны в любой момент, а не только из последнего сообщения. Рядом
 * календарь: список отвечает «что у меня сейчас», календарь — «что у меня
 * вообще».
 */
const PERSISTENT_KEYBOARD = {
  keyboard: [[{ text: 'Мои поездки' }, { text: 'Календарь' }]],
  resize_keyboard: true,
  is_persistent: true,
};

export interface SendOptions {
  /** Кнопки под сообщением одним рядом: ответ приходит как callback_query. */
  buttons?: InlineButton[];
  /** Кнопки сеткой, ряд за рядом: календарь водителя. */
  rows?: InlineButton[][];
  /** Показать постоянные кнопки под полем ввода. */
  withKeyboard?: boolean;
}

function inlineKeyboard(rows: InlineButton[][]) {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

/** Отправить сообщение. Возвращает идентификатор — по нему правят кнопки. */
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options: SendOptions | InlineButton[] = {},
): Promise<number> {
  // Массив вторым аргументом — старая форма вызова: только кнопки.
  const { buttons, rows, withKeyboard } = Array.isArray(options) ? { buttons: options } : options;
  const grid = rows ?? (buttons ? [buttons] : null);

  const result = await callTelegram<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: grid ? inlineKeyboard(grid) : withKeyboard ? PERSISTENT_KEYBOARD : undefined,
  });

  return result.message_id;
}

/**
 * Переписать сообщение вместе с кнопками: листание календаря водителя.
 *
 * Новое сообщение на каждое нажатие завалило бы переписку двенадцатью
 * календарями, поэтому правится одно и то же.
 *
 * «Message is not modified» Telegram считает ошибкой: так он отвечает, когда
 * водитель нажал кнопку месяца, который и так открыт. Для нас это не ошибка,
 * а ничего не значащее нажатие.
 */
export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  rows: InlineButton[][],
): Promise<void> {
  try {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: inlineKeyboard(rows),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('message is not modified')) {
      return;
    }
    throw error;
  }
}

/**
 * Убрать кнопки у отправленного сообщения и дописать, что выбрано.
 *
 * Требование к карточкам: выполненное действие нельзя выполнить повторно.
 * В Telegram это значит убрать клавиатуру, иначе водитель нажмёт ещё раз и
 * получит отказ без объяснения.
 */
export async function closeTelegramButtons(
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: { inline_keyboard: [] },
  });
}

/**
 * Подтвердить Telegram, что нажатие принято. Без этого у водителя крутится
 * индикатор на кнопке до таймаута.
 */
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackId,
    text,
  });
}
