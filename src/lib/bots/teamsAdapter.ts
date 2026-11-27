import 'server-only';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication } from 'botbuilder';

import type { ConfigurationBotFrameworkAuthenticationOptions } from 'botbuilder';

/**
 * Адаптер Bot Framework для Teams-бота. Все параметры берутся из переменных
 * окружения, поэтому смена регистрации бота не требует правок кода.
 * Бот заведён в Teams Developer Portal, и MICROSOFT_APP_ID не совпадает с
 * NEXT_PUBLIC_ENTRA_CLIENT_ID вкладки: портал создаёт боту отдельную
 * регистрацию приложения.
 * Боту SSO не нужен — сотрудник определяется по данным из активности Teams.
 */
const credentials: ConfigurationBotFrameworkAuthenticationOptions = {
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE,
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
};

let adapter: CloudAdapter | undefined;

export function getTeamsAdapter(): CloudAdapter {
  if (!adapter) {
    adapter = new CloudAdapter(new ConfigurationBotFrameworkAuthentication(credentials));
    adapter.onTurnError = async (_context, error) => {
      console.error('Ошибка обработки активности Teams-бота', error);
    };
  }
  return adapter;
}
