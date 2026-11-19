import { cardDone } from '@/lib/bots/cards';
import { getTeamsAdapter } from '@/lib/bots/teamsAdapter';
import { rememberConversation } from '@/modules/employees/teamsConversation';
import { handleCardAction } from '@/modules/trips/cardActions';

import type { Activity } from 'botbuilder';

/**
 * Messaging endpoint Teams-бота. Три задачи.
 *
 * Запомнить личный чат сотрудника: Teams присылает `conversationUpdate`, когда
 * человек ставит приложение, и это единственный момент, когда адрес чата
 * приходит сам.
 *
 * Обработать нажатие кнопки карточки. `Action.Submit` приходит как обычное
 * сообщение, у которого заполнено `value`, а `replyToId` указывает на саму
 * карточку — по нему карточка и перерисовывается, чтобы кнопки не нажимались
 * повторно.
 *
 * Ответить на сообщение человека, если он написал боту руками.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';

  let activity: Activity;
  try {
    activity = (await request.json()) as Activity;
  } catch {
    return new Response(null, { status: 400 });
  }

  try {
    await getTeamsAdapter().processActivityDirect(authorization, activity, async (context) => {
      const { type, conversation, serviceUrl, from, membersAdded, channelData, value, replyToId } =
        context.activity;

      const remember = async () => {
        if (from?.aadObjectId && conversation && serviceUrl) {
          await rememberConversation({
            entraOid: from.aadObjectId,
            conversationId: conversation.id,
            serviceUrl,
            tenantId: channelData?.tenant?.id ?? '',
          });
        }
      };

      // Установка приложения: среди добавленных участников — сам бот.
      const botAdded = (membersAdded ?? []).some(
        (member) => member.id === context.activity.recipient?.id,
      );

      if (type === 'conversationUpdate' && botAdded) {
        await remember();
        return;
      }

      if (type !== 'message') {
        return;
      }

      // Адрес чата обновляем и здесь: сотрудник мог поставить приложение до
      // того, как мы начали их сохранять.
      await remember();

      // Нажатие кнопки карточки
      if (value && from?.aadObjectId) {
        const result = await handleCardAction(from.aadObjectId, value);

        if (result) {
          if (result.done && replyToId) {
            // Карточка заменяется на итог: кнопок больше нет, повторно нажать
            // нечего. Если правка не удалась, человек всё равно получит ответ
            // сообщением ниже.
            try {
              await context.updateActivity({
                id: replyToId,
                type: 'message',
                attachments: [
                  {
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: cardDone('Решение принято', [], result.message),
                  },
                ],
              });
            } catch (updateError) {
              console.error('Не удалось перерисовать карточку', updateError);
            }
          }

          await context.sendActivity(result.message);
          return;
        }
      }

      if (context.activity.text) {
        // Бот не ведёт переписку: заявки оформляются во вкладке. Поэтому
        // ответ объясняет, куда идти, а не предлагает продолжить разговор.
        await context.sendActivity(
          [
            'Я сообщаю о командировках: бронь, документы, ключи, возврат.',
            '',
            'Оформить заявку и посмотреть свои поездки можно во вкладке «Мои поездки» — она рядом с этим чатом, вверху.',
            '',
            'Если что-то не получается, напишите в АХО.',
          ].join('\n'),
        );
      }
    });
  } catch (error) {
    // Ошибки внутри обработчика перехватывает onTurnError адаптера, поэтому сюда
    // доходит практически только отказ аутентификации. Отвечаем 401, а не 500:
    // при 5xx Bot Framework повторяет доставку, и одно и то же сообщение
    // обрабатывается несколько раз.
    console.error('Teams-бот: активность отклонена', error);
    return new Response(null, { status: 401 });
  }

  return new Response(null, { status: 200 });
}
