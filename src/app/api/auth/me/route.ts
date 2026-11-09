import { verifyTeamsToken } from '@/lib/auth/verifyTeamsToken';

/**
 * Проверка входа через Entra ID: вкладка присылает токен из Teams,
 * сервер его валидирует и возвращает данные сотрудника.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return Response.json({ success: false, error: 'Нет токена' }, { status: 401 });
  }

  try {
    const identity = await verifyTeamsToken(token);
    return Response.json({ success: true, data: identity });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Токен не прошёл проверку';
    return Response.json({ success: false, error: message }, { status: 401 });
  }
}
