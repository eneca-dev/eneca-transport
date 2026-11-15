import { getTeamsAdapter } from '@/lib/bots/teamsAdapter';

import type { Activity } from 'botbuilder';

/**
 * Messaging endpoint Teams-бота. Этот адрес указывается в настройках бота.
 * Пока только эхо для проверки связи (И0). В ответе возвращаются conversation id
 * и service url: они нужны для проверки исходящей отправки
 * (`scripts/teams-proactive-test.mjs`). В И1 ссылка на разговор начнёт
 * сохраняться в `teams_conversations`, и из ответа это уйдёт.
 */
export async function POST(request: Request) {
  const activity = (await request.json()) as Activity;
  const authorization = request.headers.get('authorization') ?? '';

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

  return new Response(null, { status: 200 });
}
