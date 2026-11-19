import './globals.css';

import { TeamsTheme } from '@/components/TeamsTheme';
import { APP_NAME } from '@/config/app';

import type { Metadata } from 'next';

/**
 * Корневой каркас. Вход в Teams здесь не требуется намеренно: страницы
 * `/privacy` и `/terms` обещаны манифестом Teams и должны открываться в обычном
 * браузере, в том числе у администратора, которого в нашем тенанте нет.
 *
 * Всё, что требует входа, лежит в группе `(app)` — у неё свой каркас с
 * проверкой токена и меню.
 */
export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Заявки на командировки и бронирование служебных автомобилей',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {/* Тема применяется и на публичных страницах: вне Teams останется
            системная, внутри — заданная клиентом. */}
        <TeamsTheme />
        {children}
      </body>
    </html>
  );
}
