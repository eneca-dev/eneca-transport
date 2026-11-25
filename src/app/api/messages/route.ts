import { cardDone, cardWelcome } from '@/lib/bots/cards';
import { getTeamsAdapter } from '@/lib/bots/teamsAdapter';
import { findEmployeeByOid } from '@/modules/employees/queries';
import { rememberConversation } from '@/modules/employees/teamsConversation';
import { handleCardAction } from '@/modules/trips/cardActions';
import { teamsCommandReply } from '@/modules/trips/teamsCommands';

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

      // Карточка с кнопками: и при установке, и в ответ на любое сообщение.
      const sendWelcome = async (firstTime = false) => {
        const oid = from?.aadObjectId ?? null;
        const employee = oid ? await findEmployeeByOid(oid) : null;

        // Предупреждение «вас нет в справочнике» уместно только когда мы
        // действительно искали. Без oid это была бы ложная тревога, а Teams
        // присылает его не всегда.
        const known = employee !== null || oid === null;

        await context.sendActivity({
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: cardWelcome(known, employee?.roles ?? [], firstTime),
            },
          ],
        });
      };

      if (type === 'conversationUpdate' && botAdded) {
        await remember();
        // Установка — единственный момент, когда человек точно смотрит в этот
        // чат. Молчать в него значит оставить его искать вкладку самому.
        await sendWelcome(true);
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

          // Вопрос приходит карточкой с кнопками: «Отменить поездку #97?».
          // Остальное — обычным текстом.
          if (result.reply) {
            await context.sendActivity({
              attachments: [
                {
                  contentType: 'application/vnd.microsoft.card.adaptive',
                  content: result.reply,
                },
              ],
            });
          } else {
            await context.sendActivity(result.message);
          }
          return;
        }
      }

      if (context.activity.text) {
        // Команда-подсказка под полем ввода приходит сюда обычным сообщением с
        // её названием. «Мои поездки» получает список, «Новая поездка» —
        // кнопку на форму заявки.
        const reply = await teamsCommandReply(
          from?.aadObjectId ?? null,
          context.activity.text,
        );

        if (reply) {
          await context.sendActivity({
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: reply,
              },
            ],
          });
          return;
        }

        // Бот не ведёт переписку: заявки оформляются во вкладке. Но объяснять
        // это текстом значит оставить человека искать вкладку самому, поэтому
        // ответ — кнопки, которые её открывают. Эта же карточка отвечает на
        // команду «Помощь».
        await sendWelcome();
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
