import 'server-only';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication } from 'botbuilder';

import type { ConfigurationBotFrameworkAuthenticationOptions } from 'botbuilder';

/**
 * Адаптер Bot Framework для Teams-бота. Регистрация приложения в Entra ID
 * одна и та же для вкладки и для бота, поэтому MICROSOFT_APP_ID совпадает
 * с NEXT_PUBLIC_ENTRA_CLIENT_ID.
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
    adapter.onTurnError = async (context, error) => {
      console.error('Ошибка обработки сообщения Teams-бота', error);
      await context.sendActivity('Что-то пошло не так. Попробуйте ещё раз или напишите в АХО.');
    };
  }
  return adapter;
}
