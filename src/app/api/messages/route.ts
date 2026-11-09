import { getTeamsAdapter } from '@/lib/bots/teamsAdapter';

import type { Activity } from 'botbuilder';

/**
 * Messaging endpoint Teams-бота. Этот адрес указывается в ресурсе Azure Bot.
 * Пока только эхо для проверки связи (неделя 1 плана этапа 1).
 */
export async function POST(request: Request) {
  const activity = (await request.json()) as Activity;
  const authorization = request.headers.get('authorization') ?? '';

  await getTeamsAdapter().processActivityDirect(authorization, activity, async (context) => {
    if (context.activity.type === 'message') {
      await context.sendActivity(`Связь есть. Вы написали: «${context.activity.text}»`);
    }
  });

  return new Response(null, { status: 200 });
}
