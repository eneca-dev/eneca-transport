import 'server-only';

import { getDb } from '@/config/supabase';
import { decideRemark } from '@/modules/cars/remarks';
import { notifyFinanceNewRequest } from '@/modules/documents/notify';
import { cancelTrip } from './changeService';
import { notifyTripChanged } from './notifyChange';
import { submitReturn } from './returnService';
import { setDocsReady } from '@/modules/documents/service';
import { findEmployeeByOid } from '@/modules/employees/queries';

/**
 * Нажатия на кнопки карточек Teams.
 *
 * Карточку можно переслать, а нажать её может не тот, кому она адресована.
 * Поэтому право на действие проверяется здесь по Entra OID нажавшего, а не по
 * тому, кому карточка отправлена.
 *
 * Требование к состоянию карточки: выполненное действие нельзя выполнить
 * повторно. Отсюда проверка текущего состояния поездки перед каждым действием —
 * и понятный ответ, если действие уже неактуально.
 */

export interface CardActionResult {
  /** Что показать вместо кнопок. */
  message: string;
  /** Нужно ли перерисовать карточку: при отказе оставляем кнопки как были. */
  done: boolean;
}

interface TripRow {
  id: number;
  status: string;
  author_id: string;
  needs_driver: boolean;
  keys_issued_at: string | null;
}

/** «Поеду сам» по К16: назначение водителя снимается, бронь остаётся. */
async function dropDriver(trip: TripRow, employeeId: string): Promise<CardActionResult> {
  if (!trip.needs_driver) {
    return { message: 'Поездка уже без водителя.', done: true };
  }
  if (trip.keys_issued_at !== null) {
    // Машина уже в пути. Снимать водителя с начатой поездки нельзя: кто-то
    // сейчас за рулём, и в документах он указан.
    return { message: 'Ключи уже выданы — состав поездки менять поздно.', done: true };
  }

  const db = getDb();

  const { error } = await db
    .from('trips')
    .update({
      needs_driver: false,
      driver_id: null,
      driver_confirmation: 'not_required',
      driver_assigned_at: null,
      // Состав поездки изменился — финотдел проверяет документы заново.
      docs_recheck_required: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trip.id);

  if (error) {
    console.error(`Поездка #${trip.id}: не удалось снять водителя`, error);
    return { message: 'Не получилось сохранить. Попробуйте ещё раз.', done: false };
  }

  await db.from('trip_events').insert({
    trip_id: trip.id,
    kind: 'driver_dropped',
    payload: { by: 'author_choice' },
    actor_employee: employeeId,
  });

  // Состав поездки изменился: участники, рецепция и финотдел узнают об этом из
  // К12, а финотдел ещё и получает заявку на повторную проверку.
  await notifyTripChanged(
    trip.id,
    'driver_changed',
    'Водитель не нужен — автор поедет сам',
    'driver_dropped',
  );
  await notifyFinanceNewRequest(trip.id, `recheck:driver-dropped:${Date.now()}`);

  return {
    message: [
      'Поедете сами, бронь автомобиля сохранена.',
      'Финотдел проверит документы заново — заберите их и ключи на рецепции перед выездом.',
      'Поездка осталась в разделе «Мои поездки».',
    ].join(' '),
    done: true,
  };
}

/**
 * Возврат, присланный полями карточки К8.
 *
 * Значения приходят строками: Teams складывает содержимое полей рядом с
 * данными кнопки. Пустой одометр — не ноль, иначе поездка закрылась бы с
 * нулевым пробегом.
 */
async function submitReturnFromCard(
  tripId: number,
  employeeId: string,
  value: unknown,
): Promise<CardActionResult> {
  const { odometer, condition, note } = value as {
    odometer?: unknown;
    condition?: unknown;
    note?: unknown;
  };

  const digits = typeof odometer === 'string' ? odometer.replace(/D/g, '') : '';

  if (digits === '') {
    return { message: 'Укажите показание одометра и отправьте снова.', done: false };
  }

  const outcome = await submitReturn(
    tripId,
    { employeeId },
    {
      odometerKm: Number(digits),
      conditionOk: condition !== 'remark',
      note: typeof note === 'string' ? note : '',
    },
  );

  if (!outcome.ok) {
    return { message: outcome.reason, done: false };
  }

  return {
    message: 'Показание записано. Сдайте ключи на рецепции — поездка закроется, когда их примут.',
    done: true,
  };
}

/**
 * Обработать нажатие. `null` — кнопка не наша или нажавший не имеет права,
 * тогда карточку не трогаем.
 */
export async function handleCardAction(
  entraOid: string,
  value: unknown,
): Promise<CardActionResult | null> {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { action, tripId } = value as { action?: unknown; tripId?: unknown };

  if (typeof action !== 'string' || typeof tripId !== 'number') {
    return null;
  }

  const employee = await findEmployeeByOid(entraOid);

  if (!employee || !employee.isActive) {
    return { message: 'Не удалось определить сотрудника.', done: false };
  }

  const { data: trip, error } = await getDb()
    .from('trips')
    .select('id, status, author_id, needs_driver, keys_issued_at')
    .eq('id', tripId)
    .maybeSingle<TripRow>();

  if (error || !trip) {
    return { message: 'Поездка не найдена.', done: true };
  }

  // Право зависит от действия, а не от карточки: решение по К16 принимает
  // автор, готовность документов отмечает финотдел. АХО допускается везде —
  // по требованиям она ведёт брони и решает за отсутствующих.
  const isAho = employee.roles.includes('aho');

  switch (action) {
    case 'trip_without_driver':
    case 'trip_cancel': {
      if (trip.author_id !== employee.id && !isAho) {
        return { message: 'Это решение принимает автор поездки.', done: false };
      }
      if (action === 'trip_cancel') {
        // Та же функция, что за кнопкой «Отменить» в карточке поездки: отмена
        // обязана рассылать К12 и Т4, а две копии логики однажды разойдутся.
        const outcome = await cancelTrip(trip.id, employee.id);
        return outcome.ok
          ? {
              message:
                'Поездка отменена, автомобиль освобождён. ' +
                'Она останется в «Моих поездках» со статусом «Отменена».',
              done: true,
            }
          : { message: outcome.reason, done: false };
      }
      return dropDriver(trip, employee.id);
    }
    case 'docs_ready': {
      if (!employee.roles.includes('finance') && !isAho) {
        return {
          message: 'Отметить документы готовыми может финотдел или АХО.',
          done: false,
        };
      }
      const outcome = await setDocsReady(trip.id, employee.id);
      return outcome.ok
        ? {
            message:
              'Документы отмечены готовыми. Автор получил сообщение забрать их и ключи на рецепции.',
            done: true,
          }
        : { message: outcome.reason, done: false };
    }
    case 'trip_return': {
      // Возврат по К8 оформляет автор. Поездку с водителем возвращает водитель
      // из Telegram, и карточка К8 для неё не отправляется.
      if (trip.author_id !== employee.id && !isAho) {
        return { message: 'Возврат оформляет автор поездки.', done: false };
      }
      return submitReturnFromCard(trip.id, employee.id, value);
    }
    case 'car_to_repair':
    case 'remark_handled': {
      // Замечания по машине ведёт АХО: она решает, ехать машине или в ремонт.
      if (!isAho) {
        return { message: 'Решение по замечанию принимает АХО.', done: false };
      }
      const outcome = await decideRemark(
        trip.id,
        action === 'car_to_repair' ? 'to_repair' : 'handled',
        employee.id,
      );
      if (!outcome.ok) {
        return { message: outcome.reason, done: false };
      }
      return {
        message:
          action === 'car_to_repair'
            ? 'Машина отправлена в ремонт, замечание закрыто. В заявках она больше не предлагается.'
            : 'Замечание закрыто.',
        done: true,
      };
    }
    default:
      return null;
  }
}
