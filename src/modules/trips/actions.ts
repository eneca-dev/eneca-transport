'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb } from '@/config/supabase';
import { AccessError, requireEmployee } from '@/lib/auth/currentEmployee';
import { searchEmployees } from '@/modules/employees/queries';

import { fromMinskInput } from './booking';
import { listCarOptions, listDriverOptions } from './availability';
import { notifyFinanceNewRequest } from '@/modules/documents/notify';

import { notifyTripBooked } from './notify';
import { notifyDriverAssigned } from './notifyDriver';
import { getTripCard, listMyTrips } from './queries';
import { submitReturn } from './returnService';

import type { ActionResult } from '@/lib/types';
import type { EmployeeOption } from '@/modules/employees/queries';
import type { CarOption, DriverOption } from './availability';
import type { TripCard, TripListItem } from './queries';

/**
 * Заявка и бронь поездки (Э1, Э2, Э3).
 *
 * Непересечение броней и буфер 10 минут держит база, а не эти проверки:
 * ограничения `trips_car_no_overlap` и `trips_driver_no_overlap`. Здесь они
 * только переводятся в человеческий текст — между нажатием «Далее» на шаге 2 и
 * «Отправить» на шаге 3 машину может занять кто-то другой.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const tripSchema = z
  .object({
    startDate: z.string().regex(DATE, 'Укажите дату выезда'),
    startTime: z.string().regex(TIME, 'Укажите время выезда'),
    endDate: z.string().regex(DATE, 'Укажите дату возврата'),
    endTime: z.string().regex(TIME, 'Укажите время возврата'),
    route: z.string().trim().min(3, 'Укажите маршрут').max(200, 'Слишком длинный маршрут'),
    contract: z.string().trim().min(1, 'Укажите договор').max(60, 'Слишком длинный номер договора'),
    purpose: z.string().trim().min(3, 'Укажите цель поездки').max(200, 'Слишком длинная цель'),
    participantIds: z.array(z.string().uuid()).max(20, 'Слишком много участников'),
    needsDriver: z.boolean(),
    carId: z.string().uuid('Выберите машину'),
    driverId: z.string().uuid().nullable(),
  })
  .refine((value) => !value.needsDriver || value.driverId !== null, {
    message: 'Выберите водителя или снимите отметку «нужен водитель»',
    path: ['driverId'],
  });

export type TripInput = z.infer<typeof tripSchema>;

export interface TripOptions {
  cars: CarOption[];
  drivers: DriverOption[];
}

function failure(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof AccessError) {
    return { success: false, error: error.message };
  }
  console.error(fallback, error);
  return { success: false, error: fallback };
}

export async function loadMyTrips(token: string): Promise<ActionResult<TripListItem[]>> {
  try {
    const employee = await requireEmployee(token);
    return { success: true, data: await listMyTrips(employee.id) };
  } catch (error) {
    return failure(error, 'Не удалось загрузить поездки.');
  }
}

/** Карточка поездки. Видят автор, участники и АХО. */
export async function loadTripCard(
  token: string,
  tripId: number,
): Promise<ActionResult<TripCard>> {
  try {
    const employee = await requireEmployee(token);
    const card = await getTripCard(tripId, employee.id);

    if (!card) {
      return { success: false, error: 'Поездка не найдена.' };
    }

    const allowed =
      card.isAuthor ||
      employee.roles.includes('aho') ||
      card.participants.some((person) => person.employeeId === employee.id);

    if (!allowed) {
      return { success: false, error: 'Эта поездка вам недоступна.' };
    }

    return { success: true, data: card };
  } catch (error) {
    return failure(error, 'Не удалось открыть поездку.');
  }
}

/** Поиск сотрудников для выбора участников на шаге 1. */
export async function searchParticipants(
  token: string,
  query: string,
): Promise<ActionResult<EmployeeOption[]>> {
  try {
    const employee = await requireEmployee(token);
    const found = await searchEmployees(query);
    // Автор уже в поездке, предлагать его участником незачем.
    return { success: true, data: found.filter((person) => person.id !== employee.id) };
  } catch (error) {
    return failure(error, 'Не удалось найти сотрудников.');
  }
}

/** Что свободно на выбранные даты — шаг 2. */
export async function loadTripOptions(
  token: string,
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): Promise<ActionResult<TripOptions>> {
  try {
    await requireEmployee(token);

    const startsAt = fromMinskInput(startDate, startTime);
    const endsAt = fromMinskInput(endDate, endTime);

    if (!startsAt || !endsAt) {
      return { success: false, error: 'Проверьте даты и время поездки.' };
    }
    if (endsAt <= startsAt) {
      return { success: false, error: 'Возврат должен быть позже выезда.' };
    }

    const [cars, drivers] = await Promise.all([
      listCarOptions(startsAt, endsAt),
      listDriverOptions(startsAt, endsAt),
    ]);

    return { success: true, data: { cars, drivers } };
  } catch (error) {
    return failure(error, 'Не удалось проверить занятость.');
  }
}

export interface CreatedTrip {
  tripId: number;
}

/**
 * Создать заявку и забронировать машину.
 *
 * Поездка создаётся сразу в статусе «Забронирована»: черновиков в требованиях
 * нет, а бронь должна занять интервал в тот же момент, иначе её уведут.
 */
export async function createTrip(
  token: string,
  input: TripInput,
): Promise<ActionResult<CreatedTrip>> {
  try {
    const employee = await requireEmployee(token);

    const parsed = tripSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }
    const data = parsed.data;

    const startsAt = fromMinskInput(data.startDate, data.startTime);
    const endsAt = fromMinskInput(data.endDate, data.endTime);

    if (!startsAt || !endsAt) {
      return { success: false, error: 'Проверьте даты и время поездки.' };
    }
    if (endsAt <= startsAt) {
      return { success: false, error: 'Возврат должен быть позже выезда.' };
    }
    // Бронировать уже прошедший интервал незачем. Начало в прошлом разрешено:
    // заявку нередко оформляют, когда выезд через полчаса или только что был.
    if (endsAt.getTime() <= Date.now()) {
      return { success: false, error: 'Эта поездка уже закончилась. Проверьте даты.' };
    }

    const db = getDb();

    const { data: created, error } = await db
      .from('trips')
      .insert({
        status: 'booked',
        author_id: employee.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        route: data.route,
        contract: data.contract,
        purpose: data.purpose,
        needs_driver: data.needsDriver,
        car_id: data.carId,
        driver_id: data.needsDriver ? data.driverId : null,
        driver_confirmation: data.needsDriver ? 'pending' : 'not_required',
        driver_assigned_at: data.needsDriver ? new Date().toISOString() : null,
      })
      .select('id')
      .returns<{ id: number }[]>();

    if (error) {
      return { success: false, error: bookingConflictMessage(error) };
    }

    const tripId = created[0].id;

    // Автор участником не записывается: он и так автор поездки.
    const participantIds = [...new Set(data.participantIds)].filter((id) => id !== employee.id);

    if (participantIds.length > 0) {
      const { error: participantsError } = await db
        .from('trip_participants')
        .insert(participantIds.map((id) => ({ trip_id: tripId, employee_id: id })));

      if (participantsError) {
        // Поездка без участников — это другая поездка, чем просил человек.
        // Транзакции через PostgREST нет, поэтому откатываем сами: бронь
        // только что создана, на неё никто сослаться не успел.
        await db.from('trips').delete().eq('id', tripId);
        return { success: false, error: 'Не удалось записать участников. Попробуйте ещё раз.' };
      }
    }

    // Журнал не критичен для брони: если запись не легла, поездка всё равно
    // верна, и терять её из-за строчки в журнале неправильно.
    const { error: eventError } = await db.from('trip_events').insert({
      trip_id: tripId,
      kind: 'booked',
      payload: {
        route: data.route,
        needs_driver: data.needsDriver,
        participants: participantIds.length,
      },
      actor_employee: employee.id,
    });

    if (eventError) {
      console.error(`Поездка #${tripId}: событие не записано`, eventError);
    }

    // Уведомления отправляются сразу, а не планировщиком: событие произошло.
    // Ошибки доставки внутри не выбрасываются — бронь уже создана, и отменять
    // её из-за недоставленной карточки нельзя.
    await notifyTripBooked(tripId);

    if (data.needsDriver) {
      await notifyDriverAssigned(tripId);
    }

    await notifyFinanceNewRequest(tripId);

    revalidatePath('/');
    revalidatePath(`/trips/${tripId}`);

    return { success: true, data: { tripId } };
  } catch (error) {
    return failure(error, 'Не удалось создать заявку.');
  }
}

/**
 * Отказ базы переводится в понятный текст. Имя ограничения приходит в тексте
 * ошибки, по нему и различаем, что именно увели — машину или водителя.
 */
function bookingConflictMessage(error: { code?: string; message: string }): string {
  if (error.code !== '23P01') {
    console.error('Не удалось создать бронь', error);
    return 'Не удалось создать заявку.';
  }
  if (error.message.includes('trips_driver_no_overlap')) {
    return 'Этого водителя только что назначили на другую поездку. Выберите другого.';
  }
  return 'Эту машину только что забронировали. Выберите другую.';
}

const returnSchema = z.object({
  odometerKm: z
    .number({ error: 'Укажите показание одометра' })
    .int('Только целое число')
    .min(0, 'Не может быть отрицательным')
    .max(10_000_000, 'Слишком большое значение'),
  conditionOk: z.boolean(),
  note: z.string().trim().max(500, 'Слишком длинное примечание'),
});

export type ReturnFormInput = z.infer<typeof returnSchema>;

/**
 * «Оформить возврат» в карточке поездки.
 *
 * Доступно автору поездки без водителя: по требованиям поездку с водителем
 * возвращает сам водитель из Telegram. АХО допускается — ей приходится
 * доделывать за отсутствующими.
 */
export async function submitTripReturn(
  token: string,
  tripId: number,
  input: ReturnFormInput,
): Promise<ActionResult<TripCard>> {
  try {
    const employee = await requireEmployee(token);

    const parsed = returnSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const card = await getTripCard(tripId, employee.id);

    if (!card) {
      return { success: false, error: 'Поездка не найдена.' };
    }

    const isAho = employee.roles.includes('aho');

    if (!card.isAuthor && !isAho) {
      return { success: false, error: 'Возврат оформляет автор поездки.' };
    }
    if (card.needsDriver && !isAho) {
      return {
        success: false,
        error: 'Поездку с водителем возвращает водитель — из бота в Telegram.',
      };
    }

    const outcome = await submitReturn(tripId, { employeeId: employee.id }, parsed.data);

    if (!outcome.ok) {
      return { success: false, error: outcome.reason };
    }

    revalidatePath(`/trips/${tripId}`);
    revalidatePath('/reception');
    revalidatePath('/');

    const updated = await getTripCard(tripId, employee.id);
    return updated
      ? { success: true, data: updated }
      : { success: false, error: 'Возврат записан, но карточку прочитать не удалось.' };
  } catch (error) {
    return failure(error, 'Не удалось оформить возврат.');
  }
}
