import 'server-only';

import { listOpenRemarks } from '@/modules/cars/remarks';
import { listDocumentQueue } from '@/modules/documents/queries';
import { listReceptionDay } from '@/modules/reception/queries';
import { listMyTrips } from '@/modules/trips/queries';
import { groupTrips } from '@/modules/trips/tripGroups';

import type { Employee } from '@/modules/employees/queries';

/**
 * Сколько дел ждёт человека в каждом разделе — числа для красных точек.
 *
 * Считается из самих данных, а не из таблицы прочитанного. Поэтому точка
 * гаснет не когда на неё посмотрели, а когда работа сделана: отметка
 * «прочитано» умеет врать — человек открыл список, флажок снялся, а машину так
 * и не приняли.
 *
 * Сбой одного счётчика не должен ломать полоску разделов, поэтому каждый
 * считается отдельно, а при ошибке даёт ноль: лучше без точки, чем без
 * приложения.
 */

export interface NavCounts {
  /** Свои поездки, где ждут действия этого человека. */
  mine: number;
  /** Рецепция: что можно выдать или принять прямо сейчас. */
  reception: number;
  /** Финотдел: заявки в очереди на документы. */
  documents: number;
  /** АХО: незакрытые замечания по машинам. */
  cars: number;
}

const NONE: NavCounts = { mine: 0, reception: 0, documents: 0, cars: 0 };

async function safely(what: string, count: () => Promise<number>): Promise<number> {
  try {
    return await count();
  } catch (error) {
    console.error(`Не удалось посчитать «${what}» для полоски разделов`, error);
    return 0;
  }
}

/** Что ждёт рецепцию: только то, что можно сделать сейчас. */
async function countReception(): Promise<number> {
  const day = await listReceptionDay();

  return (
    day.overdue.length +
    day.early.length +
    // Возврат без показания одометра принять нельзя — это ещё не дело рецепции.
    day.returns.filter((trip) => trip.odometerEndKm !== null).length +
    // Выдача без готовых документов тоже: их выдают вместе с ключами.
    day.issues.filter((trip) => trip.docsReady).length
  );
}

export async function countAttention(employee: Employee): Promise<NavCounts> {
  const isAho = employee.roles.includes('aho');
  const seesReception = isAho || employee.roles.includes('reception');
  const seesDocuments = isAho || employee.roles.includes('finance');

  const [mine, reception, documents, cars] = await Promise.all([
    safely('мои поездки', async () => {
      const trips = await listMyTrips(employee.id);
      const groups = groupTrips(trips, {
        isAho,
        isReception: employee.roles.includes('reception'),
        isFinance: employee.roles.includes('finance'),
      });
      return groups.find((group) => group.key === 'attention')?.trips.length ?? 0;
    }),
    seesReception ? safely('рецепция', countReception) : Promise.resolve(0),
    seesDocuments
      ? safely('документы', async () => (await listDocumentQueue()).length)
      : Promise.resolve(0),
    isAho ? safely('замечания', async () => (await listOpenRemarks()).length) : Promise.resolve(0),
  ]);

  return { ...NONE, mine, reception, documents, cars };
}
