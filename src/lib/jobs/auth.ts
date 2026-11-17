import 'server-only';

import { serverEnv } from '@/config/env';

/**
 * Задачи по расписанию вызывает Vercel Cron, а не человек: токена Teams у него
 * нет, поэтому доступ закрыт общим секретом. Vercel сам подставляет его в
 * заголовок `Authorization: Bearer <CRON_SECRET>`, если переменная задана.
 *
 * Адрес задачи публичный, так что без секрета её мог бы запустить кто угодно.
 */
export function isJobRequestAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  return header === `Bearer ${serverEnv.cronSecret}`;
}
