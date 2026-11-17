'use client';

import { useEffect } from 'react';
import { app } from '@microsoft/teams-js';

/**
 * Тема оформления из Teams.
 *
 * Teams не передаёт во вкладку ни стилей, ни переменных — только название темы,
 * и подстроиться под клиент приложение должно само. Название кладётся в
 * data-theme на <html>, а сами цвета живут в globals.css.
 *
 * Тему можно переключить в Teams на ходу, поэтому мимо getContext() нужен ещё и
 * обработчик: иначе вкладка останется в прежних цветах до перезагрузки.
 *
 * Ничего не рисует.
 */
export function TeamsTheme() {
  useEffect(() => {
    function apply(theme: string) {
      // glass — новая тема Teams с полупрозрачным фоном. Отдельной палитры для
      // неё нет, показываем светлую: она ближе всего.
      document.documentElement.dataset.theme = theme === 'glass' ? 'default' : theme;
    }

    async function run() {
      await app.initialize();
      const context = await app.getContext();
      apply(context.app.theme);
      app.registerOnThemeChangeHandler(apply);
    }

    // Вне Teams темы нет — остаётся системная из globals.css. Это не ошибка,
    // показывать её человеку незачем.
    void run().catch(() => undefined);
  }, []);

  return null;
}
