// Проверка переменных окружения: заполнены ли и похожи ли на то, чем должны быть.
// Значения не выводятся — только имя, длина и вердикт, поэтому запускать можно
// при любом свидетеле и вставлять вывод куда угодно.
//
// Типовая ошибка, которую ловит эта проверка: в поле секрета вставлен его
// идентификатор (GUID) вместо значения. Такой секрет выглядит заполненным,
// а вход при этом не работает.
//
// Запуск:
//   node --env-file=.env.local scripts/check-env.mjs

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @type {Array<{
 *   name: string,
 *   secret?: boolean,
 *   optional?: boolean,
 *   check?: (value: string) => string | null,
 * }>}
 */
const vars = [
  {
    name: 'NEXT_PUBLIC_APP_DOMAIN',
    check: (v) =>
      v.includes('://') ? 'без схемы https://' : v !== v.toLowerCase() ? 'в нижнем регистре' : null,
  },
  { name: 'ENTRA_TENANT_ID', check: (v) => (GUID.test(v) ? null : 'ожидается GUID') },
  { name: 'NEXT_PUBLIC_ENTRA_CLIENT_ID', check: (v) => (GUID.test(v) ? null : 'ожидается GUID') },
  {
    name: 'ENTRA_CLIENT_SECRET',
    secret: true,
    check: (v) => (GUID.test(v) ? 'это Secret ID, нужно значение (Value)' : null),
  },
  {
    name: 'MICROSOFT_APP_TYPE',
    check: (v) =>
      ['MultiTenant', 'SingleTenant', 'UserAssignedMSI'].includes(v)
        ? null
        : 'ожидается MultiTenant',
  },
  { name: 'MICROSOFT_APP_ID', check: (v) => (GUID.test(v) ? null : 'ожидается GUID') },
  {
    name: 'MICROSOFT_APP_PASSWORD',
    secret: true,
    check: (v) => (GUID.test(v) ? 'это Secret ID, нужно значение (Value)' : null),
  },
  {
    name: 'MICROSOFT_APP_TENANT_ID',
    optional: true,
    check: (v) => (v ? 'должно быть пустым, пока бот MultiTenant' : null),
  },
  { name: 'NEXT_PUBLIC_TEAMS_BOT_ID', check: (v) => (GUID.test(v) ? null : 'ожидается GUID') },
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    check: (v) => (/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) ? null : 'ожидается https://<ref>.supabase.co'),
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    secret: true,
    // sb_secret_… — новый формат, eyJ… — legacy service_role (JWT).
    check: (v) =>
      v.startsWith('sb_publishable_')
        ? 'это publishable key, нужен secret'
        : v.startsWith('sb_secret_') || v.startsWith('eyJ')
          ? null
          : 'ожидается sb_secret_… или eyJ…',
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    secret: true,
    check: (v) => (/^\d+:[\w-]{30,}$/.test(v) ? null : 'ожидается <цифры>:<строка> от @BotFather'),
  },
  {
    name: 'TELEGRAM_WEBHOOK_SECRET',
    secret: true,
    check: (v) =>
      /^[\w-]{16,256}$/.test(v) ? null : 'от 16 символов, только латиница, цифры, - и _',
  },
];

let problems = 0;

for (const { name, secret, optional, check } of vars) {
  const value = process.env[name] ?? '';
  const label = name.padEnd(30);

  if (!value) {
    if (optional) {
      console.log(`  ok    ${label} пусто — так и должно быть`);
    } else {
      console.log(`  ПУСТО ${label}`);
      problems += 1;
    }
    continue;
  }

  const problem = check?.(value) ?? null;
  const shown = secret ? `${value.length} символов` : value;

  if (problem) {
    console.log(`  НЕ ТО ${label} ${shown} — ${problem}`);
    problems += 1;
  } else {
    console.log(`  ok    ${label} ${shown}`);
  }
}

console.log('');

if (problems > 0) {
  console.log(`Проблем: ${problems}. Что исправить — написано выше, подробности в .env.example.`);
  process.exit(1);
}

console.log('Все переменные на месте. Это проверка формата, а не проверка');
console.log('работоспособности: верность секретов покажет только запрос.');
