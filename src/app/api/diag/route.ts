/**
 * Временная диагностика И0: почему `/api/messages` отдаёт 500 на Vercel, хотя
 * локально работает. Маршрут загружает `botbuilder` динамически и возвращает
 * текст ошибки — иначе она видна только в логах дашборда.
 *
 * Значения переменных окружения не возвращаются, только факт наличия.
 * УДАЛИТЬ после того, как причина найдена.
 */
export async function GET() {
  const result: Record<string, string | boolean> = {
    runtime: process.env.NEXT_RUNTIME ?? 'неизвестно',
    node: process.version,
    // Наличие, а не значения: по адресу маршрут открыт всем.
    MICROSOFT_APP_TYPE: process.env.MICROSOFT_APP_TYPE ?? '—',
    MICROSOFT_APP_ID: Boolean(process.env.MICROSOFT_APP_ID),
    MICROSOFT_APP_PASSWORD: Boolean(process.env.MICROSOFT_APP_PASSWORD),
  };

  try {
    const botbuilder = await import('botbuilder');
    result.botbuilderImport = 'ok';
    result.cloudAdapter = typeof botbuilder.CloudAdapter;
  } catch (error) {
    result.botbuilderImport = 'ОШИБКА';
    result.botbuilderError = error instanceof Error ? error.message : String(error);
  }

  try {
    const { getTeamsAdapter } = await import('@/lib/bots/teamsAdapter');
    getTeamsAdapter();
    result.adapterCreate = 'ok';
  } catch (error) {
    result.adapterCreate = 'ОШИБКА';
    result.adapterError = error instanceof Error ? error.message : String(error);
  }

  return Response.json(result);
}
