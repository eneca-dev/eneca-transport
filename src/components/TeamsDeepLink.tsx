'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { app } from '@microsoft/teams-js';

import { TAB_SCREENS } from '@/config/app';

import type { TabScreen } from '@/config/app';

/**
 * Переход по ссылке из чата.
 *
 * Кнопки в карточках бота ведут на вкладку и передают цель в `subEntityId`:
 * `trip-127` — карточка поездки, `screen-new` — форма заявки. Teams открывает
 * вкладку на её обычном адресе, а цель кладёт в контекст — развернуть её в
 * переход должно само приложение, иначе человек попадает в общий список.
 *
 * Так работает и кнопка «Новая поездка» в чате: переключить вкладку за
 * человека бот не может, он может только дать ссылку.
 *
 * Срабатывает один раз при открытии вкладки. Ничего не рисует.
 */
export function TeamsDeepLink() {
  const router = useRouter();

  useEffect(() => {
    async function run() {
      await app.initialize();
      const context = await app.getContext();
      const target = context.page.subPageId;

      if (!target) {
        return;
      }

      const tripId = /^trip-(\d+)$/.exec(target)?.[1];
      if (tripId) {
        router.replace(`/trips/${tripId}`);
        return;
      }

      // Экран из закрытого списка: значение пришло снаружи, и подставлять его
      // в путь как есть нельзя.
      const screen = /^screen-([a-z]+)$/.exec(target)?.[1];
      if (screen && Object.hasOwn(TAB_SCREENS, screen)) {
        router.replace(TAB_SCREENS[screen as TabScreen]);
      }
    }

    // Вне Teams контекста нет — это не ошибка, показывать её незачем.
    void run().catch(() => undefined);
  }, [router]);

  return null;
}
