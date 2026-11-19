import './globals.css';

import { AppShell } from '@/components/AppShell';
import { TeamsAuthProvider } from '@/components/TeamsAuth';
import { TeamsDeepLink } from '@/components/TeamsDeepLink';
import { TeamsTheme } from '@/components/TeamsTheme';
import { APP_NAME } from '@/config/app';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Заявки на командировки и бронирование служебных автомобилей',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        {/* Тема применяется и когда вход не удался: сообщение об ошибке тоже
            должно быть в цветах клиента. */}
        <TeamsTheme />
        <TeamsDeepLink />
        <TeamsAuthProvider>
          <AppShell>{children}</AppShell>
        </TeamsAuthProvider>
      </body>
    </html>
  );
}
