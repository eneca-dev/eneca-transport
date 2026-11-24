'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { useTeamsAuth } from '@/components/TeamsAuth';
import { loadNavCounts } from '@/modules/nav/actions';

import type { ReactNode } from 'react';
import type { NavCounts } from '@/modules/nav/queries';

/**
 * Сколько дел ждёт в каждом разделе — для красных точек в полоске и для блока
 * «Требует внимания» на первом экране.
 *
 * Считается один раз на открытие вкладки и ещё раз при переходе между
 * разделами: после выдачи ключей или отметки документов число меняется, а
 * переход — естественный момент его обновить. Опроса по таймеру нет: лишние
 * запросы ради цифры, на которую смотрят раз в день, не нужны.
 *
 * Ошибку счётчиков наружу не показываем: это украшение полоски, а не работа.
 * Не посчиталось — точек просто нет.
 */

interface NavCountsValue {
  counts: NavCounts | null;
  refresh: () => void;
}

const NavCountsContext = createContext<NavCountsValue | null>(null);

export function useNavCounts(): NavCountsValue {
  const value = useContext(NavCountsContext);
  if (!value) {
    throw new Error('useNavCounts вызван вне NavCountsProvider');
  }
  return value;
}

export function NavCountsProvider({ children }: { children: ReactNode }) {
  const { getToken } = useTeamsAuth();
  const pathname = usePathname();

  const [counts, setCounts] = useState<NavCounts | null>(null);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const result = await loadNavCounts(await getToken());
        if (result.success) {
          setCounts(result.data);
        }
      } catch {
        // Молча: без точек вкладка работает.
      }
    })();
  }, [getToken]);

  useEffect(refresh, [refresh, pathname]);

  return (
    <NavCountsContext.Provider value={{ counts, refresh }}>{children}</NavCountsContext.Provider>
  );
}
