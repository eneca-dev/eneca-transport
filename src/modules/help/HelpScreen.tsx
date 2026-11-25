'use client';

import Link from 'next/link';

import { CARD } from '@/components/controls';
import { useTeamsAuth } from '@/components/TeamsAuth';
import { TELEGRAM_BOT_LINK } from '@/config/app';

import type { ReactNode } from 'react';

/**
 * «Как пользоваться» — короткая инструкция прямо во вкладке.
 *
 * Коротко — это требование, а не пожелание: инструкцию на три экрана не
 * читают. Поэтому одна строка на мысль, блоки по роли показываются только тем,
 * у кого роль есть, и ни одного предложения, объясняющего очевидное.
 *
 * Мерить стоит словами, а не экранами: сотруднику без ролей — около ста,
 * вместе со всеми ролями — чуть больше двухсот. Длиннее — значит что-то
 * сказано дважды. Первая версия была 382 слова, и это было много.
 */

interface BlockProps {
  title: string;
  children: ReactNode;
}

function Block({ title, children }: BlockProps) {
  return (
    <section className={`mt-4 ${CARD} p-4`}>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 space-y-1.5 text-sm text-fg-soft">{children}</div>
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

/** Выделение внутри строки — только на названиях кнопок и разделов. */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-fg">{children}</strong>;
}

export function HelpScreen() {
  const { employee } = useTeamsAuth();

  const has = (role: string) => employee.roles.includes(role as never);
  const isAho = has('aho');

  return (
    <div>
      <h1 className="text-lg font-semibold">Как пользоваться</h1>
      <p className="mt-1 text-sm text-fg-soft">
        Заявки на командировки и служебные машины. О ходе поездки пишет бот «Командировки».
      </p>

      <Block title="Поездка по шагам">
        <Step n={1}>
          <B>Новая поездка</B>: даты, маршрут, участники, договор, цель.
        </Step>
        <Step n={2}>Машина и водитель — в списке только свободные на эти даты.</Step>
        <Step n={3}>Отправить. Машина занята сразу, двойной брони не бывает.</Step>
        <Step n={4}>Финотдел готовит документы — придёт сообщение.</Step>
        <Step n={5}>Документы и ключи — на рецепции перед выездом.</Step>
        <Step n={6}>После поездки — одометр и состояние, ключи на рецепцию.</Step>
        <p>Перенести и отменить можно в карточке поездки, пока ключи не выданы.</p>
      </Block>

      <Block title="Как читать список">
        <p>
          Поездка зовётся <B>Гомель/01.12</B> — куда и когда.
        </p>
        <p>
          <B>«От вас»</B> — ждут вас. <B>Красная рамка</B> — проблема, причина написана рядом.
        </p>
        <p>Число у раздела: серое — работа, красное — срочное. Гаснет, когда сделано.</p>
      </Block>

      {(has('reception') || isAho) && (
        <Block title="Рецепция">
          <p>
            <B>Выдать</B> — только с готовыми документами. <B>Принять</B> — только с показанием
            одометра.
          </p>
          <p>Привезли раньше срока — блок «Досрочный возврат», планового дня не ждём.</p>
          <p>«Не выехали» — за ключами не пришли, такую заявку стоит отменить.</p>
        </Block>
      )}

      {(has('finance') || isAho) && (
        <Block title="Финотдел">
          <p>
            <B>Документы готовы</B> открывает рецепции выдачу ключей. Кнопка есть и в карточке
            бота.
          </p>
          <p>Заявку изменили — отметка снимается, заявка возвращается в очередь.</p>
          <p>Красная строка — выезд меньше чем через сутки, а документов нет.</p>
        </Block>
      )}

      {isAho && (
        <Block title="АХО">
          <p>Календарь — занятость машин и водителей по дням.</p>
          <p>Машины, Водители, Роли — справочники, ремонт, отсутствие, коды, доступы.</p>
          <p>Водитель, перенос, отмена, исправление одометра — в карточке поездки.</p>
        </Block>
      )}

      <Block title="Если что-то не так">
        <p>
          <B>Бот молчит.</B> Напишите ему любое сообщение: первым он писать не может.
        </p>
        <p>
          <B>Водитель не подтвердил.</B> Пятнадцать минут — просьба, а не срок; решает АХО.
        </p>
        <p>
          <B>Ошибка в одометре.</B> До приёма ключей — там же, где вводили; после — через АХО.
        </p>
        <p>
          <B>Водителям</B> — бот{' '}
          <a
            href={TELEGRAM_BOT_LINK}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            @eneca_trips_bot
          </a>
          , код выдаёт АХО.
        </p>
      </Block>

      <p className="mt-4 text-xs text-fg-soft">
        Чего-то не хватает — скажите в АХО.{' '}
        <Link href="/" className="underline underline-offset-2">
          К поездкам
        </Link>
      </p>
    </div>
  );
}
