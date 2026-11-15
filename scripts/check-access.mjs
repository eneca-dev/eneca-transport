// Проверка доступов: действительно ли работают секреты из .env.local.
// В отличие от check-env.mjs, который смотрит только формат, здесь делаются
// настоящие запросы к Entra ID, Bot Connector, Supabase и Telegram.
//
// Все четыре проверки читающие, ничего не меняют. Секреты не выводятся.
//
// Запуск:
//   node --env-file=.env.local scripts/check-access.mjs

const results = [];

function ok(what, detail) {
  results.push({ ok: true, what, detail });
  console.log(`  ok    ${what.padEnd(22)} ${detail}`);
}

function fail(what, detail, hint) {
  results.push({ ok: false, what, detail, hint });
  console.log(`  СБОЙ  ${what.padEnd(22)} ${detail}`);
  if (hint) console.log(`        ${hint}`);
}

/** Токен приложения по client_credentials. */
async function appToken(authority, clientId, clientSecret, scope) {
  const response = await fetch(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    // В описании ошибки Entra встречается номер вида AADSTS7000215 — по нему
    // понятно, что именно не так, поэтому он сохраняется.
    const code = /AADSTS\d+/.exec(body.error_description ?? '')?.[0] ?? body.error ?? '';
    throw new Error(`${response.status} ${code}`);
  }
  return body.access_token;
}

// --- 1. Entra ID: секрет вкладки и согласие на User.Read.All ----------------

let graphToken;
try {
  graphToken = await appToken(
    process.env.ENTRA_TENANT_ID,
    process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID,
    process.env.ENTRA_CLIENT_SECRET,
    'https://graph.microsoft.com/.default',
  );
  ok('Entra ID: секрет', 'токен получен');
} catch (error) {
  fail(
    'Entra ID: секрет',
    String(error.message),
    'AADSTS7000215 — неверный секрет: вставлено значение не от этой регистрации или Secret ID вместо Value.',
  );
}

if (graphToken) {
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/users?$top=1&$select=id,jobTitle,department',
    { headers: { authorization: `Bearer ${graphToken}` } },
  );
  if (response.ok) {
    const body = await response.json();
    const user = body.value?.[0];
    // Проверяется не только доступ, но и наличие полей: User.ReadBasic.All их
    // не отдаёт, а схема employees их требует.
    const fields = user
      ? ['jobTitle', 'department'].filter((f) => f in user).join(', ') || 'нет полей должности'
      : 'справочник пуст';
    ok('Graph: справочник', `доступ есть, поля: ${fields}`);
  } else {
    const body = await response.text();
    const forbidden = response.status === 403;
    fail(
      'Graph: справочник',
      `${response.status}`,
      forbidden
        ? 'Нет согласия администратора на application-разрешение User.Read.All.'
        : body.slice(0, 200),
    );
  }
}

// --- 2. Bot Connector: секрет бота и тип приложения -------------------------

const botAuthority =
  (process.env.MICROSOFT_APP_TYPE || 'MultiTenant').toLowerCase() === 'singletenant'
    ? process.env.MICROSOFT_APP_TENANT_ID
    : 'botframework.com';

try {
  await appToken(
    botAuthority,
    process.env.MICROSOFT_APP_ID,
    process.env.MICROSOFT_APP_PASSWORD,
    'https://api.botframework.com/.default',
  );
  ok('Teams-бот: секрет', `токен получен через ${botAuthority}`);
} catch (error) {
  fail(
    'Teams-бот: секрет',
    String(error.message),
    'Проверить секрет со страницы бота в Developer Portal и MICROSOFT_APP_TYPE.',
  );
}

// --- 3. Supabase: ключ и применена ли схема ---------------------------------

{
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/employees?select=id&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (response.ok) {
    ok('Supabase: ключ', 'доступ есть, таблица employees на месте');
  } else {
    const body = await response.text();
    if (response.status === 404 || body.includes('does not exist')) {
      fail('Supabase: схема', 'таблицы employees нет', 'Миграция 0001_init.sql ещё не применена.');
    } else {
      fail('Supabase: ключ', `${response.status}`, body.slice(0, 200));
    }
  }
}

// --- 4. Telegram: токен бота ------------------------------------------------

{
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
  const body = await response.json();
  if (body.ok) {
    ok('Telegram: токен', `бот @${body.result.username}`);
  } else {
    fail('Telegram: токен', body.description ?? `${response.status}`, 'Токен от @BotFather, целиком.');
  }
}

// --- Итог -------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log('Все доступы работают.');
} else {
  console.log(`Не работает: ${failed.map((r) => r.what).join(', ')}`);
  process.exit(1);
}
