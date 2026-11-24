import 'server-only';

import { z } from 'zod';

import { cardCancelConfirm } from '@/lib/bots/cards';
import { getDb } from '@/config/supabase';
import { decideRemark } from '@/modules/cars/remarks';
import { notifyFinanceNewRequest } from '@/modules/documents/notify';
import { assignDriver, cancelTrip, changeCar, confirmForDriver } from './changeService';
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
  /**
   * Ответить новой карточкой, а не текстом. Нужно, чтобы задать вопрос: в
   * адаптивной карточке нет своих диалогов, а браузерные Teams не показывает.
   * Прежняя карточка при этом остаётся на месте.
   */
  reply?: unknown;
}

interface TripRow {
  id: number;
  status: string;
  author_id: string;
  needs_driver: boolean;
  keys_issued_at: string | null;
  starts_at: string;
  ends_at: string;
  route: string;
}

const idSchema = z.string().uuid();

/** «Без водителя» по К16: назначение водителя снимается, бронь остаётся. */
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

  // Лишнее убираем сами: человек пишет «85 136» или «85136 км». Вычищать надо
  // всё нецифровое. Здесь стоял шаблон `/D/g` — он убирал только латинскую
  // букву D, поэтому «85 136» превращалось в не-число, в базу уходило пустое
  // значение, а карточка отвечала «показание записано».
  const digits = typeof odometer === 'string' ? odometer.replace(/\D/g, '') : '';

  if (digits === '') {
    return { message: 'Укажите показание одометра числом и отправьте снова.', done: false };
  }

  const odometerKm = Number(digits);

  if (!Number.isSafeInteger(odometerKm)) {
    return { message: 'Это не похоже на показание одометра. Введите число заново.', done: false };
  }

  const outcome = await submitReturn(
    tripId,
    { employeeId },
    {
      odometerKm,
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
    .select('id, status, author_id, needs_driver, keys_issued_at, starts_at, ends_at, route')
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
    /**
     * «Отменить» в К1 — только вопрос, отмена идёт вторым нажатием.
     *
     * Своих диалогов в карточке нет, браузерные Teams не показывает, поэтому
     * вопрос приходит отдельной карточкой. Прежняя карточка остаётся: если
     * человек нажал случайно, он просто ничего больше не нажимает.
     */
    case 'trip_cancel_ask': {
      if (trip.author_id !== employee.id && !isAho) {
        return { message: 'Отменить поездку может автор или АХО.', done: false };
      }
      if (trip.status === 'cancelled') {
        return { message: 'Поездка уже отменена.', done: true };
      }
      if (trip.keys_issued_at !== null) {
        return { message: 'Ключи уже выданы — отменять поздно, машину надо принять.', done: true };
      }
      return {
        message: `Отменить поездку №${trip.id}?`,
        done: false,
        reply: cardCancelConfirm(trip.id, trip.starts_at, trip.ends_at, trip.route),
      };
    }
    case 'trip_cancel_abort': {
      return { message: 'Хорошо, поездка остаётся в силе.', done: true };
    }
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
    case 'driver_confirm_aho': {
      // Подтверждение за водителя — решение АХО: она звонит водителю, когда он
      // не ответил в боте. Автору такого права нет, иначе подтверждение
      // перестаёт что-либо значить.
      if (!isAho) {
        return { message: 'Подтвердить за водителя может АХО.', done: false };
      }
      const outcome = await confirmForDriver(trip.id, employee.id);
      return outcome.ok
        ? {
            message:
              'Поездка подтверждена за водителя. Водитель получил сообщение в Telegram, ' +
              'в журнале заявки записано, что подтвердили вы.',
            done: true,
          }
        : { message: outcome.reason, done: false };
    }
    /**
     * «Выбрать другую» и «Назначить водителя» из К13.
     *
     * Список в карточке посчитан в момент отправки, поэтому выбранного могли
     * занять. Проверяет это служба — та же, что за кнопками в карточке
     * поездки, — и отвечает причиной отказа, не снимая кнопки.
     */
    case 'car_change': {
      if (trip.author_id !== employee.id && !isAho) {
        return { message: 'Машину меняет автор поездки или АХО.', done: false };
      }
      const { carId } = value as { carId?: unknown };
      if (!idSchema.safeParse(carId).success) {
        return { message: 'Выберите машину в списке и нажмите снова.', done: false };
      }
      const outcome = await changeCar(trip.id, employee.id, carId as string);
      return outcome.ok
        ? {
            message:
              'Машина заменена, бронь переехала на неё. ' +
              'Финотдел проверит документы заново — в них указана машина.',
            done: true,
          }
        : { message: outcome.reason, done: false };
    }
    case 'driver_assign': {
      if (!isAho) {
        return { message: 'Водителя назначает АХО.', done: false };
      }
      const { driverId } = value as { driverId?: unknown };
      if (!idSchema.safeParse(driverId).success) {
        return { message: 'Выберите водителя в списке и нажмите снова.', done: false };
      }
      const outcome = await assignDriver(trip.id, employee.id, driverId as string);
      return outcome.ok
        ? {
            message:
              'Водитель назначен. Ему ушёл запрос подтверждения на 15 минут, ' +
              'финотдел проверит документы заново.',
            done: true,
          }
        : { message: outcome.reason, done: false };
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
