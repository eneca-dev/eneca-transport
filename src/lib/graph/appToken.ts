import 'server-only';

import { serverEnv } from '@/config/env';

/**
 * Токен приложения для Microsoft Graph (client credentials).
 *
 * Кэшируется в памяти процесса: Entra выдаёт токен на час, а запросов к Graph
 * в одной синхронизации десятки. На Vercel процесс живёт недолго, поэтому кэш
 * просто не успевает устареть; запас в минуту защищает от гонки на границе.
 */

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cached: CachedToken | undefined;

export async function getGraphToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${serverEnv.entraTenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: serverEnv.entraClientId,
        client_secret: serverEnv.entraClientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
      cache: 'no-store',
    },
  );

  const body: unknown = await response.json();
  const token = typeof body === 'object' && body !== null && 'access_token' in body
    ? (body as { access_token?: unknown }).access_token
    : undefined;

  if (!response.ok || typeof token !== 'string') {
    const description =
      typeof body === 'object' && body !== null && 'error_description' in body
        ? String((body as { error_description?: unknown }).error_description).split('\n')[0]
        : `${response.status}`;
    throw new Error(`Graph не выдал токен: ${description}`);
  }

  cached = { value: token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return token;
}
