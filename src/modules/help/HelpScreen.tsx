'use client';

import Link from 'next/link';

import { CARD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { TELEGRAM_BOT_LINK } from '@/config/app';

import type { ReactNode } from 'react';

/**
 * «Как пользоваться» — короткая инструкция прямо во вкладке.
 *
 * Коротко намеренно: инструкцию на три экрана не читают, а вопросы задают те
 * же пять. Поэтому здесь путь поездки, часть про роли — только тому, у кого
 * роль есть, — и ответы на вопросы, которые точно будут.
 */

interface BlockProps {
  title: string;
  children: ReactNode;
}

function Block({ title, children }: BlockProps) {
  return (
    <section className={`mt-4 ${CARD} p-4`}>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-fg-soft">{children}</div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <p className="flex gap-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-soft text-xs font-semibold text-fg">
        {n}
      </span>
      <span>{children}</span>
    </p>
  );
}

export function HelpScreen() {
  const { employee } = useTeamsAuth();

  const has = (role: string) => employee.roles.includes(role as never);
  const isAho = has('aho');

  return (
    <div>
      <h1 className="text-lg font-semibold">Как пользоваться</h1>
      <p className="mt-1 text-sm text-fg-soft">
        Заявки на командировки и бронирование служебных машин. Всё делается здесь, во вкладке, а
        сообщения о ходе поездки присылает бот «Командировки» в личный чат Teams.
      </p>

      <Block title="Поездка от заявки до закрытия">
        <Step n={1}>
          <strong className="font-medium text-fg">Новая поездка</strong> — даты и время, маршрут,
          участники, договор, цель. И сразу: нужен водитель или поедете сами.
        </Step>
        <Step n={2}>
          Выбор машины и водителя. В списке видно, кто свободен на эти даты, а кто занят и до
          какого времени.
        </Step>
        <Step n={3}>
          Проверка и отправка. Бронь занимает машину сразу, двойной брони быть не может.
        </Step>
        <Step n={4}>
          Финотдел готовит документы. Когда они готовы, придёт сообщение — документы и ключи
          забираете на рецепции перед выездом.
        </Step>
        <Step n={5}>
          После возврата: если поездка без водителя — в карточке поездки кнопка{' '}
          <strong className="font-medium text-fg">«Оформить возврат»</strong>: показание одометра,
          состояние машины, примечание. Если с водителем — это делает он сам в Telegram.
        </Step>
        <Step n={6}>
          Ключи сдаются на рецепции. Поездка закрывается, когда их приняли, и вы получите итог с
          пробегом.
        </Step>
        <p>
          <strong className="font-medium text-fg">Перенести или отменить</strong> можно в карточке
          поездки — до выдачи ключей. После выдачи машина уже в пути, её остаётся принять.
        </p>
      </Block>

      <Block title="Как читать список">
        <p>
          Поездка называется по направлению и дате:{' '}
          <strong className="font-medium text-fg">Гомель/01.12</strong>. Номер вида{' '}
          <span className="font-mono">№42</span> нужен для документов и чтобы сослаться на поездку
          в разговоре.
        </p>
        <p>
          Наверху списка — группа{' '}
          <strong className="font-medium text-fg">«Требует внимания»</strong>: поездки, где ждут
          именно вас. Под состоянием поездки такая строка начинается со слов «От вас».
        </p>
        <p>
          Красное число у названия раздела — сколько там дел. Оно гаснет, когда работа сделана, а
          не когда на него посмотрели.
        </p>
      </Block>

      {(has('reception') || isAho) && (
        <Block title="Рецепция">
          <p>
            <strong className="font-medium text-fg">Выдать</strong> — только когда финотдел
            отметил документы готовыми: документы выдаются вместе с ключами.
          </p>
          <p>
            <strong className="font-medium text-fg">Принять</strong> — только когда передано
            показание одометра. Без него поездку закрывать нельзя.
          </p>
          <p>
            Машину, привезённую раньше планового дня, принимайте из блока{' '}
            <strong className="font-medium text-fg">«Досрочный возврат»</strong> — ждать этого дня
            не нужно. Просроченная поездка принимается так же: другая бронь на эту машину не
            мешает. Выдать её следующему можно через десять минут после приёма.
          </p>
          <p>Стрелками у даты смотрятся другие дни — но выдавать и принимать можно только сегодня.</p>
        </Block>
      )}

      {(has('finance') || isAho) && (
        <Block title="Финотдел">
          <p>
            В разделе <strong className="font-medium text-fg">«Документы»</strong> — очередь
            заявок с данными для документов: участники, даты, маршрут, договор, цель.
          </p>
          <p>
            Кнопка <strong className="font-medium text-fg">«Документы готовы»</strong> открывает
            рецепции выдачу ключей. Её же можно нажать прямо в карточке, которую присылает бот.
          </p>
          <p>
            Если заявку изменили, отметка снимается и заявка возвращается в очередь с пометкой, что
            именно изменилось: прежний комплект документов уже не годится.
          </p>
        </Block>
      )}

      {isAho && (
        <Block title="АХО">
          <p>
            <strong className="font-medium text-fg">Календарь</strong> — занятость машин и
            водителей по дням: брони, ремонт, отсутствие водителей.
          </p>
          <p>
            <strong className="font-medium text-fg">Машины</strong> и{' '}
            <strong className="font-medium text-fg">Водители</strong> — справочники, отметки «в
            ремонте» и «недоступен», код для подключения водителя к Telegram, замечания после
            поездок.
          </p>
          <p>
            <strong className="font-medium text-fg">Роли</strong> — кто видит рецепцию, документы и
            разделы АХО. Последнюю роль АХО снять нельзя: без неё роли станет некому выдавать.
          </p>
          <p>
            Назначение и замена водителя, перенос, отмена, смена машины и исправление одометра
            после закрытия — в карточке поездки.
          </p>
        </Block>
      )}

      <Block title="Частые вопросы">
        <p>
          <strong className="font-medium text-fg">Не приходят сообщения от бота.</strong> Бот не
          может написать первым, пока приложение у человека не установлено. Напишите боту
          «Командировки» любое сообщение — после этого сообщения будут приходить.
        </p>
        <p>
          <strong className="font-medium text-fg">Водитель не подтвердил поездку.</strong>{' '}
          Пятнадцать минут — это просьба, а не срок: водитель часто за рулём. Если он молчит, АХО
          получает сообщение и решает вопрос звонком. Подтвердить он может и позже.
        </p>
        <p>
          <strong className="font-medium text-fg">Ошибка в показании одометра.</strong> Пока ключи
          не приняты, значение исправляется там же, где вводилось. После закрытия поездки — только
          через АХО и с указанием причины: прежнее значение сохраняется в истории.
        </p>
        <p>
          <strong className="font-medium text-fg">Водителям.</strong> Поездки, подтверждение и
          возврат — в Telegram-боте{' '}
          <a
            href={TELEGRAM_BOT_LINK}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            @eneca_trips_bot
          </a>
          . Код для подключения выдаёт АХО.
        </p>
      </Block>

      <p className="mt-4 text-xs text-fg-soft">
        Чего-то не хватает или что-то работает не так — скажите в АХО.{' '}
        <Link href="/" className="underline underline-offset-2">
          Вернуться к поездкам
        </Link>
      </p>
    </div>
  );
}
