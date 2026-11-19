// Применение миграции к базе проекта через Management API Supabase.
//
// Зачем отдельный скрипт. MCP-сервер `supabase` в рабочем окружении настроен на
// другой проект, а `service_role` key через PostgREST не умеет DDL. Остаётся
// Management API — тот же путь, которым работает SQL-редактор в браузере.
//
// Нужен personal access token из Supabase: Account → Access Tokens. Он даёт
// доступ ко ВСЕМ проектам аккаунта, поэтому кладётся только в .env.local и
// после применения миграций его стоит отозвать.
//
// Запуск:
//   node --env-file=.env.local scripts/apply-migration.mjs supabase/migrations/0002_...sql
//   node --env-file=.env.local scripts/apply-migration.mjs --list
//
// Файл применяется одной транзакцией: при ошибке в середине база остаётся
// такой, какой была.

import { readFile } from 'node:fs/promises';

/** Единственный проект, к которому этому скрипту позволено обращаться. */
const EXPECTED_REF = 'eywylwfnjjmhxvouvcoi';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Нет SUPABASE_ACCESS_TOKEN. Создать: Supabase → Account → Access Tokens.');
  console.error('Положить в .env.local, значение никуда больше не копировать.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1];

if (!ref) {
  console.error(`NEXT_PUBLIC_SUPABASE_URL не похож на адрес проекта: ${url || 'пусто'}`);
  process.exit(1);
}

// Соседние проекты того же стека (геймификация, бот протоколов, RAG, чат)
// живут в том же аккаунте. Промах здесь означает DDL в чужой базе.
if (ref !== EXPECTED_REF) {
  console.error(`Это проект ${ref}, а база командировок — ${EXPECTED_REF}. Ничего не делаю.`);
  process.exit(1);
}

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const target = process.argv[2];

if (!target) {
  console.error('Укажите файл миграции или --list.');
  process.exit(1);
}

try {
  if (target === '--list') {
    const tables = await query(
      "select table_name from information_schema.tables " +
        "where table_schema = 'public' order by table_name",
    );
    console.log(`Проект ${ref}, таблиц и представлений: ${tables.length}`);
    for (const row of tables) {
      console.log(`  ${row.table_name}`);
    }
    process.exit(0);
  }

  const sql = await readFile(target, 'utf8');
  console.log(`Проект ${ref}, файл ${target}, строк: ${sql.split('\n').length}`);

  await query(`begin;\n${sql}\ncommit;`);
  console.log('Применено.');
} catch (error) {
  console.error(`Не применено. ${error.message}`);
  process.exit(1);
}
