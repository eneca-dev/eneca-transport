import 'server-only';

import { cardMyTrips, cardNewTrip } from '@/lib/bots/cards';
import { matchTeamsCommand } from '@/lib/bots/commands';
import { formatPeriod } from '@/lib/datetime';
import { findEmployeeByOid } from '@/modules/employees/queries';

import { listMyTrips } from './queries';
import { tripLabelFrom } from './tripLabel';
import { tripState } from './tripStatus';

/**
 * Ответы бота Teams на команды-подсказки.
 *
 * Подсказка под полем ввода приходит боту обычным сообщением с её названием,
 * поэтому команда — это разбор текста (`lib/bots/commands`), а не особое
 * событие.
 *
 * Состояние поездки считается тем же `tripState`, что и на экране Э1: иначе
 * бот и вкладка называли бы одну поездку по-разному.
 */

/** Сколько поездок показывать в чате. Остальные — во вкладке. */
const SHOWN = 5;

/**
 * Что ответить на сообщение. `null` — это не команда (или ответить нечем), и
 * тогда уходит приветственная карточка с кнопками: она же служит справкой.
 */
export async function teamsCommandReply(
  entraOid: string | null,
  text: string,
): Promise<unknown | null> {
  const command = matchTeamsCommand(text);

  if (command === null || command === 'help') {
    return null;
  }

  if (command === 'new_trip') {
    return cardNewTrip();
  }

  if (!entraOid) {
    return null;
  }

  try {
    const employee = await findEmployeeByOid(entraOid);

    if (!employee || !employee.isActive) {
      return null;
    }

    const trips = await listMyTrips(employee.id);
    const roles = {
      isAho: employee.roles.includes('aho'),
      isReception: employee.roles.includes('reception'),
      isFinance: employee.roles.includes('finance'),
    };

    const lines = trips.slice(0, SHOWN).map((trip) => {
      const state = tripState(trip, { ...roles, isAuthor: trip.isAuthor });

      return {
        label: tripLabelFrom(trip.route, trip.startsAt, trip.endsAt),
        period: formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt)),
        route: trip.route,
        state: state.label,
        waitingFor: state.waitingFor,
      };
    });

    return cardMyTrips(lines, Math.max(0, trips.length - lines.length));
  } catch (error) {
    // Ответить общей карточкой лучше, чем промолчать: человек хотя бы попадёт
    // во вкладку и увидит список там.
    console.error('Не удалось собрать список поездок для чата', error);
    return null;
  }
}
