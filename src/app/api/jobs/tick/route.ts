import { isJobRequestAuthorized } from '@/lib/jobs/auth';
import { runDeadlines } from '@/modules/trips/deadlines';

/**
 * Проверка сроков. Vercel Cron вызывает её раз в минуту — требование
 * спецификации: «проверка подтверждений — не реже раза в минуту».
 *
 * Vercel вызывает задачи методом GET и передаёт CRON_SECRET в заголовке
 * Authorization. POST оставлен для запуска вручную тем же секретом.
 *
 * Проход идемпотентен, поэтому пропущенный или сдвоенный запуск безвреден.
 */
export const maxDuration = 60;

async function run(request: Request) {
  if (!isJobRequestAuthorized(request)) {
    return Response.json({ success: false, error: 'Нет доступа' }, { status: 401 });
  }

  try {
    return Response.json({ success: true, data: await runDeadlines() });
  } catch (error) {
    console.error('Проверка сроков не выполнена', error);
    return Response.json(
      { success: false, error: 'Проверка сроков не выполнена' },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
