// Проверка исходящей отправки: бот пишет сотруднику сам, без входящего сообщения.
// На этом построены все напоминания, поэтому проверяется в И0, а не в И5.
//
// Повторяет схему рабочего бота протоколов (eneca-dev/Eneca_AI_bot,
// services/teams_sender.py): токен по client_credentials → POST активности
// в Bot Connector. Намеренно без botbuilder — так видно, что именно отказало.
//
// Два режима:
//
//   --oid <entraOid>                   бот сам создаёт личный чат с сотрудником.
//                                      Так будут уходить все напоминания: в базе
//                                      хранится Entra OID, а не conversation id.
//                                      Работает только если приложение у этого
//                                      сотрудника установлено.
//
//   <conversationId> <serviceUrl>      отправка в уже существующий чат. Значения
//                                      бот показывает в ответе на входящее
//                                      сообщение.
//
// Регион Bot Connector для режима --oid: по умолчанию emea. Переопределяется
// через --region amer|emea|apac|india. В режиме с conversationId регион не нужен —
// service url приходит вместе с активностью.
//
// Запуск:
//   node --env-file=.env.local scripts/teams-proactive-test.mjs --oid cd66d937-…
//   node --env-file=.env.local scripts/teams-proactive-test.mjs <conversationId> <serviceUrl>

const argv = process.argv.slice(2);

/** Значение именованного аргумента вида `--name value`. */
function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const SERVICE_URLS = {
  amer: 'https://smba.trafficmanager.net/amer/',
  emea: 'https://smba.trafficmanager.net/emea/',
  apac: 'https://smba.trafficmanager.net/apac/',
  india: 'https://smba.trafficmanager.net/in/',
};

const oid = option('oid');
const region = option('region') ?? 'emea';
const positional = argv.filter((value, index) => {
  if (value.startsWith('--')) return false;
  return !argv[index - 1]?.startsWith('--');
});

const appId = process.env.MICROSOFT_APP_ID;
const appPassword = process.env.MICROSOFT_APP_PASSWORD;
const appType = (process.env.MICROSOFT_APP_TYPE || 'MultiTenant').toLowerCase();
const botTenantId = process.env.MICROSOFT_APP_TENANT_ID;
// Тенант, в котором живёт сотрудник. Для multi-tenant бота он не совпадает
// с MICROSOFT_APP_TENANT_ID: тот пустой, а Teams требует tenant id в channelData.
const teamsTenantId = process.env.ENTRA_TENANT_ID;

if (!oid && positional.length < 2) {
  console.error('Использование:');
  console.error('  node --env-file=.env.local scripts/teams-proactive-test.mjs --oid <entraOid>');
  console.error('  node --env-file=.env.local scripts/teams-proactive-test.mjs <conversationId> <serviceUrl>');
  process.exit(1);
}
if (!appId || !appPassword) {
  console.error('Нужны MICROSOFT_APP_ID и MICROSOFT_APP_PASSWORD в .env.local');
  process.exit(1);
}
if (oid && !teamsTenantId) {
  console.error('Для режима --oid нужен ENTRA_TENANT_ID в .env.local');
  process.exit(1);
}
if (oid && !SERVICE_URLS[region]) {
  console.error(`Неизвестный регион «${region}». Допустимо: ${Object.keys(SERVICE_URLS).join(', ')}`);
  process.exit(1);
}

// Multi-tenant бот берёт токен у общего центра botframework.com, single-tenant —
// у своего тенанта. Перепутать нельзя: Bot Connector ответит 401.
const authority = appType === 'singletenant' ? botTenantId : 'botframework.com';
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

/** Вызов Bot Connector. Возвращает разобранный ответ либо печатает отказ и выходит. */
async function connector(serviceUrl, path, body) {
  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('');
    console.error(`${path} → ${response.status}`);
    console.error(text);
    console.error('');
    if (response.status === 401 || response.status === 403) {
      console.error('401 или 403 — токен выдан, но Bot Connector его не принял.');
      console.error('Проверить: включён ли канал Microsoft Teams у бота и совпадает ли');
      console.error('MICROSOFT_APP_ID с идентификатором бота в манифесте приложения.');
    }
    if (response.status === 404 && path.endsWith('/conversations')) {
      console.error('404 на создании чата — приложение не установлено у этого сотрудника,');
      console.error('либо регион service url другой. Попробовать --region amer.');
    }
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

let serviceUrl;
let conversationId;

if (oid) {
  serviceUrl = SERVICE_URLS[region];
  console.log(`регион     ${region} (${serviceUrl})`);
  console.log('');

  // Teams сам находит сотрудника по Entra OID и отдаёт личный чат с ботом.
  // Чат один и тот же при повторных вызовах, дублей не будет.
  const conversation = await connector(serviceUrl, '/v3/conversations', {
    isGroup: false,
    bot: { id: `28:${appId}` },
    members: [{ id: oid }],
    channelData: { tenant: { id: teamsTenantId } },
  });

  conversationId = conversation.id;
  console.log('Чат создан (или найден существующий).');
  console.log(`  conversation id  ${conversationId}`);
  console.log(`  service url      ${serviceUrl}`);
  console.log('');
} else {
  [conversationId, serviceUrl] = positional;
}

await connector(serviceUrl, `/v3/conversations/${encodeURIComponent(conversationId)}/activities`, {
  type: 'message',
  text: 'Проверка исходящей отправки. Это сообщение бот отправил сам, без входящего.',
});

console.log('Отправлено. Сообщение должно появиться в чате с ботом.');
