import 'server-only';

import { getDb } from '@/config/supabase';

/**
 * Адрес личного чата сотрудника с Teams-ботом.
 *
 * Бот не может написать первым тому, кто приложение не ставил. Когда ставит —
 * Teams присылает `conversationUpdate`, и это единственный момент, когда адрес
 * чата приходит сам, без запроса. Сохранённый адрес избавляет от обращения
 * к Bot Connector на каждую отправку.
 */

interface RememberInput {
  /** Entra OID из активности Teams: по нему находим сотрудника в справочнике. */
  entraOid: string;
  conversationId: string;
  serviceUrl: string;
  tenantId: string;
}

export async function rememberConversation(input: RememberInput): Promise<void> {
  const db = getDb();

  const { data: employee, error } = await db
    .from('employees')
    .select('id')
    .eq('entra_oid', input.entraOid)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error('Не удалось найти сотрудника по Entra OID', error);
    return;
  }

  if (!employee) {
    // Человек есть в Entra, но справочник его ещё не видел: синхронизация идёт
    // раз в сутки. Чат запомним при следующем обращении.
    console.warn(`Чат Teams не сохранён: ${input.entraOid} нет в справочнике`);
    return;
  }

  const { error: saveError } = await db.from('teams_conversations').upsert({
    employee_id: employee.id,
    conversation_id: input.conversationId,
    service_url: input.serviceUrl,
    tenant_id: input.tenantId,
    updated_at: new Date().toISOString(),
  });

  if (saveError) {
    console.error('Не удалось сохранить чат Teams', saveError);
  }
}
