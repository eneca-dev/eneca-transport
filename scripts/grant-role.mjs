// Выдача и снятие ролей приложения.
//
// Роли назначает АХО в интерфейсе, но первого АХО назначить неоткуда —
// поэтому он выдаётся этим скриптом. Дальше скрипт нужен только для
// восстановления: если роль случайно снимут со всех, в приложение не войти.
//
// Запуск:
//   node --env-file=.env.local scripts/grant-role.mjs --list
//   node --env-file=.env.local scripts/grant-role.mjs <почта|oid> aho
//   node --env-file=.env.local scripts/grant-role.mjs --revoke <почта|oid> aho

const ROLES = ['aho', 'reception', 'finance'];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY. Запускать с --env-file=.env.local');
  process.exit(1);
}

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function list() {
  const rows = await rest(
    'employee_roles?select=role,granted_at,employees!employee_roles_employee_id_fkey(display_name,upn)&order=role',
  );
  if (!rows.length) {
    console.log('Роли ещё никому не выданы.');
    return;
  }
  for (const role of ROLES) {
    const holders = rows.filter((r) => r.role === role);
    console.log(`\n${role} (${holders.length}):`);
    for (const h of holders) {
      console.log(`  ${h.employees?.display_name ?? '—'}  ${h.employees?.upn ?? ''}`);
    }
  }
}

/** Сотрудник ищется и по почте, и по Entra OID: удобнее, чем помнить формат. */
async function findEmployee(identifier) {
  const value = encodeURIComponent(identifier);
  const query = identifier.includes('@')
    ? `employees?upn=ilike.${value}&select=id,display_name,upn`
    : `employees?entra_oid=eq.${value}&select=id,display_name,upn`;
  const rows = await rest(query);
  if (!rows.length) {
    throw new Error(`Сотрудник ${identifier} не найден. Синхронизация справочника выполнялась?`);
  }
  return rows[0];
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--list') {
    await list();
    return;
  }

  const revoke = args[0] === '--revoke';
  const [identifier, role] = revoke ? args.slice(1) : args;

  if (!identifier || !role) {
    console.error('Нужны два значения: почта или oid, затем роль.');
    console.error(`Роли: ${ROLES.join(', ')}`);
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Неизвестная роль ${role}. Доступны: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  const employee = await findEmployee(identifier);

  if (revoke) {
    await rest(`employee_roles?employee_id=eq.${employee.id}&role=eq.${role}`, { method: 'DELETE' });
    console.log(`Снято: ${role} у ${employee.display_name} (${employee.upn})`);
    return;
  }

  await rest('employee_roles', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ employee_id: employee.id, role }),
  });
  console.log(`Выдано: ${role} — ${employee.display_name} (${employee.upn})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
