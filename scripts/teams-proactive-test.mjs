// Проверка исходящей отправки: бот пишет сотруднику сам, без входящего сообщения.
// На этом построены все напоминания, поэтому проверяется в И0, а не в И5.
//
// Повторяет схему рабочего бота протоколов (eneca-dev/Eneca_AI_bot,
// services/teams_sender.py): токен по client_credentials → POST активности
// в Bot Connector. Намеренно без botbuilder — так видно, что именно отказало.
//
// Как получить аргументы: написать боту в Teams, он ответит и покажет
// conversation id и service url.
//
// Запуск:
//   node --env-file=.env.local scripts/teams-proactive-test.mjs <conversationId> <serviceUrl>

const [conversationId, serviceUrl] = process.argv.slice(2);

const appId = process.env.MICROSOFT_APP_ID;
const appPassword = process.env.MICROSOFT_APP_PASSWORD;
const appType = (process.env.MICROSOFT_APP_TYPE || 'MultiTenant').toLowerCase();
const tenantId = process.env.MICROSOFT_APP_TENANT_ID;

if (!conversationId || !serviceUrl) {
  console.error('Использование: node --env-file=.env.local scripts/teams-proactive-test.mjs <conversationId> <serviceUrl>');
  process.exit(1);
}
if (!appId || !appPassword) {
  console.error('Нужны MICROSOFT_APP_ID и MICROSOFT_APP_PASSWORD в .env.local');
  process.exit(1);
}

// Multi-tenant бот берёт токен у общего центра botframework.com, single-tenant —
// у своего тенанта. Перепутать нельзя: Bot Connector ответит 401.
const authority = appType === 'singletenant' ? tenantId : 'botframework.com';
if (!authority) {
  console.error('При MICROSOFT_APP_TYPE=SingleTenant нужен MICROSOFT_APP_TENANT_ID');
  process.exit(1);
}

console.log(`тип бота   ${process.env.MICROSOFT_APP_TYPE || 'MultiTenant (по умолчанию)'}`);
console.log(`центр      login.microsoftonline.com/${authority}`);
console.log('');

const tokenResponse = await fetch(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: appId,
    client_secret: appPassword,
    scope: 'https://api.botframework.com/.default',
  }),
});

if (!tokenResponse.ok) {
  console.error(`Токен не выдан: ${tokenResponse.status}`);
  console.error(await tokenResponse.text());
  console.error('');
  console.error('Частые причины: неверный секрет, либо MICROSOFT_APP_TYPE не совпадает');
  console.error('с типом регистрации бота в Entra («Поддерживаемые типы учётных записей»).');
  process.exit(1);
}

const { access_token: accessToken } = await tokenResponse.json();
console.log('Токен получен.');

const activityResponse = await fetch(
  `${serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: 'Проверка исходящей отправки. Это сообщение бот отправил сам.',
    }),
  },
);

if (!activityResponse.ok) {
  console.error(`Сообщение не отправлено: ${activityResponse.status}`);
  console.error(await activityResponse.text());
  console.error('');
  if (activityResponse.status === 401 || activityResponse.status === 403) {
    console.error('401 или 403 на этом шаге — токен выдан, но Bot Connector его не принял.');
    console.error('Проверить: включён ли канал Microsoft Teams у бота и совпадает ли');
    console.error('MICROSOFT_APP_ID с идентификатором бота в манифесте приложения.');
  }
  process.exit(1);
}

console.log('Отправлено. Сообщение должно появиться в чате с ботом.');
