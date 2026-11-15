// Включение вебхука Telegram. Адрес и секрет берутся из переменных окружения,
// поэтому руками ничего собирать не нужно: адрес вида
// `https://api.telegram.org/bot<токен>/setWebhook` легко собрать с ошибкой,
// и Telegram отвечает на это невнятным 404.
//
// Запускать после каждой смены домена или TELEGRAM_WEBHOOK_SECRET: вебхук
// хранится на стороне Telegram и сам не обновляется.
//
// Запуск:
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs --info   # только показать текущий

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
const onlyInfo = process.argv.includes('--info');

if (!token || !domain || (!onlyInfo && !secret)) {
  console.error('Нужны TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_APP_DOMAIN и TELEGRAM_WEBHOOK_SECRET в .env.local');
  process.exit(1);
}

/** Вызов метода Bot API. Токен в адресе, поэтому сам адрес никогда не печатаем. */
async function api(method, params) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const body = await response.json();
  if (!body.ok) {
    throw new Error(`${method}: ${body.error_code} ${body.description}`);
  }
  return body.result;
}

const url = `https://${domain}/api/telegram`;

try {
  if (!onlyInfo) {
    // allowed_updates сужает поток: нужны только сообщения и нажатия кнопок.
    await api('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    console.log(`Вебхук установлен: ${url}`);
    console.log('');
  }

  const info = await api('getWebhookInfo');
  console.log('Текущее состояние вебхука');
  console.log(`  адрес                 ${info.url || '— не установлен'}`);
  // Установлен ли secret_token, Telegram не сообщает: проверяется только тем,
  // что бот отвечает. Без секрета наш endpoint отдаёт 401, и ниже была бы
  // видна последняя ошибка.
  console.log(`  типы обновлений       ${(info.allowed_updates ?? ['все']).join(', ')}`);
  console.log(`  необработанных        ${info.pending_update_count ?? 0}`);
  if (info.last_error_message) {
    console.log(`  последняя ошибка      ${info.last_error_message}`);
    console.log(`  когда                 ${new Date(info.last_error_date * 1000).toISOString()}`);
  } else {
    console.log('  последняя ошибка      нет');
  }
} catch (error) {
  const message = String(error.message);
  console.error(message);
  console.error('');
  if (message.includes('404')) {
    console.error('404 Not Found — неверный токен: проверить TELEGRAM_BOT_TOKEN,');
    console.error('он должен быть целиком, вида <цифры>:<строка>, без скобок и пробелов.');
  } else if (message.includes('fetch failed')) {
    console.error('До api.telegram.org не удалось дозвониться. Это сеть, а не токен:');
    console.error('повторить запуск. Состояние вебхука на стороне Telegram не изменилось.');
  }
  process.exit(1);
}
