import 'server-only';

import { randomInt } from 'node:crypto';

import { getDb } from '@/config/supabase';
import {
  acceptNote,
  acceptOdometer,
  askReturnStep,
  listDriverTrips,
} from '@/modules/trips/driverReturn';

import type { BotReply } from '@/modules/trips/driverReturn';

/**
 * Привязка Telegram водителя.
 *
 * Telegram не позволяет боту написать первым тому, кто ему не писал. Поэтому
 * первый шаг всегда делает водитель: открывает бота и вводит код, который АХО
 * выдала в Э9. Пока код не введён, ни одно сообщение Т1–Т6 до водителя дойти
 * не может — привязка обязательна до первой поездки.
 *
 * Бот публичный: его находят поиском в Telegram. Значит код может вводить кто
 * угодно, и защита строится на двух вещах — длине кода и ограничении попыток.
 */

/** Сколько живёт код привязки. Задано спецификацией. */
const CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Шесть знаков вместо четырёх из примера в спецификации: четырёхзначных кодов
 * всего 10 000, и они перебираются за минуты. Шесть — миллион, и вместе с
 * ограничением попыток перебор становится бессмысленным. Диктовать по телефону
 * по-прежнему удобно.
 */
const CODE_DIGITS = 6;

/** Сколько неудачных попыток разрешено одному чату и за какое время. */
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

export interface IssuedCode {
  code: string;
  expiresAt: string;
}

/** Кто написал боту. Имя нужно АХО, чтобы сверить, что код ввёл водитель. */
export interface TelegramSender {
  chatId: number;
  /** Приватный чат или группа: привязка разрешена только в приватном. */
  isPrivate: boolean;
  username: string | null;
  displayName: string | null;
}

/**
 * Выдать код водителю. Прежние неиспользованные коды этого водителя удаляются:
 * действующий код всегда один, иначе непонятно, какой диктовать.
 */
export async function issueCode(driverId: string, createdBy: string): Promise<IssuedCode> {
  const db = getDb();

  await db.from('driver_link_codes').delete().eq('driver_id', driverId).is('used_at', null);

  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
  const min = 10 ** (CODE_DIGITS - 1);
  const max = 10 ** CODE_DIGITS;

  // Совпадение с уже выданным кодом возможно, поэтому несколько попыток:
  // столкновение отсекает первичный ключ.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(randomInt(min, max));
    const { error } = await db
      .from('driver_link_codes')
      .insert({ code, driver_id: driverId, expires_at: expiresAt, created_by: createdBy });

    if (!error) {
      return { code, expiresAt };
    }
    if (error.code !== '23505') {
      throw new Error(`Не удалось выдать код: ${error.message}`);
    }
  }

  throw new Error('Не удалось подобрать свободный код. Попробуйте ещё раз.');
}

interface ClaimedCodeRow {
  driver_id: string;
}

interface DriverNameRow {
  full_name: string;
}

interface AttemptsRow {
  failed_count: number;
  window_started_at: string;
}

const CODE_PATTERN = new RegExp(`^\\d{${CODE_DIGITS}}$`);

/** Водитель, привязанный к этому чату. */
async function driverByChat(chatId: number): Promise<{ id: string; full_name: string } | null> {
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
 * Ответ бота на сообщение водителя. Отправку делает вебхук.
 *
 * Порядок проверок важен. Код привязки — шесть цифр, показание одометра тоже
 * цифры. Поэтому сначала смотрим, не привязан ли уже этот чат, и только у
 * непривязанного считаем цифры кодом. Иначе водитель с шестизначным одометром
 * привязывался бы заново вместо сдачи машины.
 */
export async function replyToDriver(sender: TelegramSender, text: string): Promise<BotReply> {
  const message = text.trim();
  const driver = sender.isPrivate ? await driverByChat(sender.chatId) : null;

  if (driver) {
    if (message === 'Мои поездки') {
      return listDriverTrips(driver.id);
    }

    if (/^\d+$/.test(message)) {
      const odometer = await acceptOdometer(driver.id, message);
      if (odometer) {
        return odometer;
      }
    }

    // Любой другой текст во время возврата — это примечание.
    const note = await acceptNote(driver.id, message);
    if (note) {
      return note;
    }

    const step = await askReturnStep(driver.id);
    if (step) {
      return step;
    }

    return {
      text: [
        `Вы подключены как ${driver.full_name}.`,
        '',
        'Назначения придут сюда сами. Нажмите «Мои поездки», чтобы посмотреть, что за вами.',
      ].join('\n'),
      withKeyboard: true,
    };
  }

  if (CODE_PATTERN.test(message)) {
    // В группе привязка запрещена: иначе назначения на поездки с фамилиями
    // пассажиров ушли бы всем участникам чата.
    if (!sender.isPrivate) {
      return { text: 'Код вводится только в личной переписке с ботом, не в группе.' };
    }
    return { text: await bindByCode(message, sender), withKeyboard: true };
  }

  if (message.startsWith('/start')) {
    return {
      text: [
        'Это бот командировок ЭНЭКА. Через него приходят назначения на поездки.',
        '',
        `Введите код из ${CODE_DIGITS} цифр, который выдали в АХО.`,
      ].join('\n'),
    };
  }

  return {
    text: `Пока вы не подключены. Введите код из ${CODE_DIGITS} цифр, который выдали в АХО.`,
  };
}

/** Привязать чат к водителю по коду. */
async function bindByCode(code: string, sender: TelegramSender): Promise<string> {
  const db = getDb();

  if (await isBlocked(sender.chatId)) {
    return 'Слишком много неверных попыток. Попробуйте через час.';
  }

  // Код гасится тем же запросом, которым проверяется: если два человека введут
  // его одновременно, строку получит только первый.
  const { data: claimed, error: claimError } = await db
    .from('driver_link_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('driver_id')
    .returns<ClaimedCodeRow[]>();

  if (claimError) {
    throw new Error(`Не удалось проверить код: ${claimError.message}`);
  }

  const driverId = claimed?.[0]?.driver_id;
  if (!driverId) {
    await countFailure(sender.chatId);
    return 'Код не подошёл: он действует сутки и вводится один раз. Попросите в АХО новый.';
  }

  // Этот же Telegram мог быть привязан к другому водителю — например, телефон
  // передали другому человеку. chat_id уникален, поэтому прежнюю привязку
  // снимаем, иначе вставка упадёт.
  const { error: detachError } = await db
    .from('drivers')
    .update({
      telegram_chat_id: null,
      telegram_linked_at: null,
      telegram_username: null,
      telegram_display_name: null,
    })
    .eq('telegram_chat_id', sender.chatId)
    .neq('id', driverId);

  if (detachError) {
    throw new Error(`Не удалось снять прежнюю привязку: ${detachError.message}`);
  }

  const { data: driver, error: linkError } = await db
    .from('drivers')
    .update({
      telegram_chat_id: sender.chatId,
      telegram_linked_at: new Date().toISOString(),
      telegram_username: sender.username,
      telegram_display_name: sender.displayName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', driverId)
    .select('full_name')
    .returns<DriverNameRow[]>();

  if (linkError) {
    throw new Error(`Не удалось привязать Telegram: ${linkError.message}`);
  }

  await db.from('telegram_link_attempts').delete().eq('chat_id', sender.chatId);

  const name = driver?.[0]?.full_name ?? 'водитель';
  return `Вы подключены как ${name}. Сюда будут приходить назначения на поездки.`;
}

/** Исчерпал ли чат попытки в текущем окне. */
async function isBlocked(chatId: number): Promise<boolean> {
  const { data, error } = await getDb()
    .from('telegram_link_attempts')
    .select('failed_count, window_started_at')
    .eq('chat_id', chatId)
    .maybeSingle<AttemptsRow>();

  if (error) {
    // Ошибку счётчика наружу не пускаем: иначе его сбой закрыл бы подключение
    // совсем. В логах она останется.
    console.error('Telegram: не удалось прочитать счётчик попыток', error);
    return false;
  }

  if (!data) {
    return false;
  }

  const windowFresh = Date.now() - new Date(data.window_started_at).getTime() < ATTEMPT_WINDOW_MS;
  return windowFresh && data.failed_count >= MAX_FAILED_ATTEMPTS;
}

/** Засчитать неудачную попытку. Истёкшее окно начинается заново. */
async function countFailure(chatId: number): Promise<void> {
  const db = getDb();
  const now = new Date();

  const { data, error } = await db
    .from('telegram_link_attempts')
    .select('failed_count, window_started_at')
    .eq('chat_id', chatId)
    .maybeSingle<AttemptsRow>();

  if (error) {
    console.error('Telegram: не удалось прочитать счётчик попыток', error);
    return;
  }

  const windowFresh =
    data !== null && now.getTime() - new Date(data.window_started_at).getTime() < ATTEMPT_WINDOW_MS;

  const { error: writeError } = await db.from('telegram_link_attempts').upsert({
    chat_id: chatId,
    failed_count: windowFresh ? data.failed_count + 1 : 1,
    window_started_at: windowFresh ? data.window_started_at : now.toISOString(),
    updated_at: now.toISOString(),
  });

  if (writeError) {
    console.error('Telegram: не удалось записать попытку', writeError);
  }
}
