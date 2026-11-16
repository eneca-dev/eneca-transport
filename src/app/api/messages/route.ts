import { getDb } from '@/config/supabase';
import { getTeamsAdapter } from '@/lib/bots/teamsAdapter';

import type { Activity } from 'botbuilder';

/**
 * Временно (И0): запись факта входящего запроса в `debug_inbound`.
 * Runtime Logs в Vercel на этом проекте пусты даже для запросов, которые
 * точно обработаны функцией, поэтому нужен независимый след. Удалить вместе
 * с таблицей, когда И0 закроется.
 */
async function record(row: Record<string, unknown>): Promise<number | undefined> {
  try {
    const { data } = await getDb().from('debug_inbound').insert(row).select('id').single();
    return data?.id as number | undefined;
  } catch {
    // Диагностика не должна ломать обработчик.
    return undefined;
  }
}

/** Временно (И0): отметка результата у ранее записанной строки. */
async function finish(id: number | undefined, outcome: string) {
  if (id === undefined) return;
  try {
    await getDb().from('debug_inbound').update({ outcome }).eq('id', id);
  } catch {
    // Намеренно молча.
  }
}

/**
 * Messaging endpoint Teams-бота. Этот адрес указывается в настройках бота.
 * Пока только эхо для проверки связи (И0). В ответе возвращаются conversation id
 * и service url: они нужны для проверки исходящей отправки
 * (`scripts/teams-proactive-test.mjs`). В И1 ссылка на разговор начнёт
 * сохраняться в `teams_conversations`, и из ответа это уйдёт.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';

  let activity: Activity;
  try {
    activity = (await request.json()) as Activity;
  } catch {
    await record({ source: 'teams', has_auth: Boolean(authorization), outcome: 'битый JSON' });
    return new Response(null, { status: 400 });
  }

  const logId = await record({
    source: 'teams',
    has_auth: Boolean(authorization),
    activity_type: activity.type ?? null,
    conversation_id: activity.conversation?.id ?? null,
    service_url: activity.serviceUrl ?? null,
    outcome: 'получен',
  });

  try {
    await getTeamsAdapter().processActivityDirect(authorization, activity, async (context) => {
      if (context.activity.type === 'message') {
        const { conversation, serviceUrl } = context.activity;
        await context.sendActivity(
          [
            `Связь есть. Вы написали: «${context.activity.text}»`,
            '',
            `conversation id: ${conversation?.id ?? '—'}`,
            `service url: ${serviceUrl ?? '—'}`,
          ].join('\n\n'),
        );
      }
    });
  } catch (error) {
    // Ошибки внутри обработчика перехватывает onTurnError адаптера, поэтому сюда
    // доходит практически только отказ аутентификации. Отвечаем 401, а не 500:
    // при 5xx Bot Framework повторяет доставку, и одно и то же сообщение
    // обрабатывается несколько раз.
    console.error('Teams-бот: активность отклонена', error);
    await finish(logId, `отклонён: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    return new Response(null, { status: 401 });
  }

  await finish(logId, 'обработан');
  return new Response(null, { status: 200 });
}
