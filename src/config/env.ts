import 'server-only';

/** Серверные переменные окружения. Секреты в браузер не попадают. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}. См. .env.example`);
  }
  return value;
}

export const serverEnv = {
  get entraTenantId() {
    return required('ENTRA_TENANT_ID');
  },
  get entraClientId() {
    return required('NEXT_PUBLIC_ENTRA_CLIENT_ID');
  },
  get entraClientSecret() {
    return required('ENTRA_CLIENT_SECRET');
  },
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get telegramBotToken() {
    return required('TELEGRAM_BOT_TOKEN');
  },
  get telegramWebhookSecret() {
    return required('TELEGRAM_WEBHOOK_SECRET');
  },
} as const;
