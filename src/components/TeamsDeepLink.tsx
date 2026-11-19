'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { app } from '@microsoft/teams-js';

/**
 * Переход по ссылке из карточки бота.
 *
 * Кнопка «Открыть» в карточках ведёт на вкладку и передаёт номер поездки в
 * `subEntityId`. Teams открывает вкладку на её обычном адресе, а номер кладёт
 * в контекст — развернуть его в переход на карточку поездки должно само
 * приложение, иначе человек попадает в общий список.
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
      }
    }

    // Вне Teams контекста нет — это не ошибка, показывать её незачем.
    void run().catch(() => undefined);
  }, [router]);

  return null;
}
