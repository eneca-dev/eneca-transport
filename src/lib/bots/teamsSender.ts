import 'server-only';

import { serverEnv } from '@/config/env';
import { getDb } from '@/config/supabase';

/**
 * Исходящие сообщения Teams-бота: бот пишет сотруднику сам.
 *
 * Схема проверена 16.11 на живом сотруднике, который боту не писал:
 * токен по client_credentials → `POST /v3/conversations` создаёт или находит
 * личный чат по Entra OID → отправка активности. Botbuilder здесь не нужен:
 * ему нужна входящая активность, а у напоминаний её нет.
 *
 * Обязательное условие: приложение установлено у этого сотрудника. Иначе
 * Bot Connector отвечает 404 на создании чата — Teams не позволяет боту
 * написать первым тому, кто приложение не ставил.
 */

/**
 * Регион Bot Connector. Тенант ЭНЭКА обслуживается европейским, проверено
 * 16.11. Адрес нужен только для первого обращения: дальше он сохраняется
 * вместе с чатом, потому что Teams может ответить и другим.
 */
const DEFAULT_SERVICE_URL = 'https://smba.trafficmanager.net/emea/';

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cached: CachedToken | undefined;

/**
 * Токен Bot Connector. При `MICROSOFT_APP_TYPE=SingleTenant` выдаёт его тенант
 * ЭНЭКА, а не общий центр botframework.com: проверено 16.11, токен от
 * botframework.com получает 401 «Authorization has been denied».
 */
async function getBotToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${serverEnv.teamsBotTenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: serverEnv.teamsBotId,
        client_secret: serverEnv.teamsBotPassword,
        scope: 'https://api.botframework.com/.default',
      }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`Bot Connector не выдал токен: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Bot Connector вернул ответ без токена');
  }

  // Токен живёт час; обновляем за пять минут до конца.
  cached = { value: payload.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return cached.value;
}

async function connector<T>(serviceUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await getBotToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await response.text();

  if (!response.ok) {
    // Приложение не установлено у получателя. Bot Connector отвечает на это
    // по-разному: 403 «Bot is not installed in user's personal scope»
    // (проверено 19.11) и 404, если сотрудника вообще не нашли в тенанте.
    // Оба случая для нас одно и то же — писать некуда.
    if (path.endsWith('/conversations') && (response.status === 403 || response.status === 404)) {
      throw new NotInstalledError();
    }
    throw new Error(`Bot Connector ${path} → ${response.status} ${text}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/** Приложение не установлено — писать некуда, и это не ошибка нашего кода. */
export class NotInstalledError extends Error {
  constructor() {
    super('Приложение Teams не установлено у этого сотрудника');
  }
}

export interface Conversation {
  conversationId: string;
  serviceUrl: string;
}

interface ConversationRow {
  conversation_id: string;
  service_url: string;
}

/**
 * Личный чат сотрудника с ботом. Сохранённый используется повторно, иначе
 * создаётся: Teams на повторный запрос отдаёт тот же чат, дублей не бывает.
 */
export async function ensureConversation(
  employeeId: string,
  entraOid: string,
): Promise<Conversation> {
  const db = getDb();

  const { data: saved, error } = await db
    .from('teams_conversations')
    .select('conversation_id, service_url')
    .eq('employee_id', employeeId)
    .maybeSingle<ConversationRow>();

  if (error) {
    throw new Error(`Не удалось прочитать чат: ${error.message}`);
  }
  if (saved) {
    return { conversationId: saved.conversation_id, serviceUrl: saved.service_url };
  }

  const created = await connector<{ id: string }>(DEFAULT_SERVICE_URL, '/v3/conversations', {
    isGroup: false,
    bot: { id: `28:${serverEnv.teamsBotId}` },
    members: [{ id: entraOid }],
    channelData: { tenant: { id: serverEnv.entraTenantId } },
  });

  const conversation: Conversation = {
    conversationId: created.id,
    serviceUrl: DEFAULT_SERVICE_URL,
  };

  const { error: saveError } = await db.from('teams_conversations').upsert({
    employee_id: employeeId,
    conversation_id: conversation.conversationId,
    service_url: conversation.serviceUrl,
    tenant_id: serverEnv.entraTenantId,
    updated_at: new Date().toISOString(),
  });

  if (saveError) {
    // Не роняем отправку: чат есть, просто в следующий раз создадим заново.
    console.error('Не удалось сохранить чат Teams', saveError);
  }

  return conversation;
}

/**
 * Отправить адаптивную карточку. Возвращает идентификатор сообщения — по нему
 * карточку потом правят, убирая кнопки после выполненного действия.
 */
export async function sendCard(
  employeeId: string,
  entraOid: string,
  card: unknown,
): Promise<string> {
  const { conversationId, serviceUrl } = await ensureConversation(employeeId, entraOid);

  const sent = await connector<{ id: string }>(
    serviceUrl,
    `/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
    {
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
    },
  );

  return sent.id;
}
