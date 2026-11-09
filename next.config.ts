import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // botbuilder тянет @azure/identity → open → powershell-utils, который при
  // сборке обращается к пути powershell.exe. В бандл его включать не нужно:
  // пакет серверный и загружается в рантайме.
  serverExternalPackages: ['botbuilder'],
  // cacheComponents выключен осознанно: почти все данные приложения
  // персональные и всегда свежие (брони, очередь документов, экран рецепции),
  // кэшировать нечего, а запрет на route segment config ломает вебхуки ботов.
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
