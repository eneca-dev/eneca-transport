import 'server-only';
import { createClient } from '@supabase/supabase-js';

import { serverEnv } from '@/config/env';

import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

/**
 * Клиент Supabase с service_role. Вход в приложение идёт через Entra ID,
 * а не через Supabase Auth, поэтому RLS не используется: доступ к данным
 * проверяется на сервере по роли сотрудника (employee_roles).
 * Этот клиент не должен попадать в клиентские компоненты.
 *
 * Инициализация ленивая: переменные окружения не требуются на этапе сборки.
 */
export function getDb(): SupabaseClient {
  client ??= createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
