import { isJobRequestAuthorized } from '@/lib/jobs/auth';
import { syncEmployees } from '@/modules/employees/sync';

/**
 * Синхронизация справочника сотрудников из Microsoft Graph.
 *
 * Запускается Vercel Cron раз в сутки (расписание — в `vercel.json`). Cron
 * ходит методом GET; POST оставлен для ручного запуска, когда нужно обновить
 * справочник немедленно.
 */

// В каталоге около тысячи записей и несколько страниц Graph: локально
// синхронизация заняла 14 секунд, минуты хватает с запасом.
export const maxDuration = 60;

async function run(request: Request) {
  if (!isJobRequestAuthorized(request)) {
    return Response.json({ success: false, error: 'Нет доступа' }, { status: 401 });
  }

  try {
    const result = await syncEmployees();
    return Response.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Синхронизация не удалась';
    console.error('Синхронизация сотрудников:', error);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
