import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

import { AppShell } from '@/components/AppShell';
import { TeamsAuthProvider } from '@/components/TeamsAuth';
import { APP_NAME } from '@/config/app';

import type { Metadata } from 'next';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'cyrillic'],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Заявки на командировки и бронирование служебных автомобилей',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-gray-50 text-gray-900">
        <TeamsAuthProvider>
          <AppShell>{children}</AppShell>
        </TeamsAuthProvider>
      </body>
    </html>
  );
}
