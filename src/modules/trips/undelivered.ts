import 'server-only';

import { cardUndelivered } from '@/lib/bots/cards';
import { sendCard } from '@/lib/bots/teamsSender';
import { getDb } from '@/config/supabase';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import { tripLabelFrom } from './tripLabel';

import type { OutboxEntry } from '@/modules/notifications/outbox';

/**
 * Сообщение водителю не дошло — об этом узнаёт АХО.
 *
 * Бот Telegram не может написать первым тому, кто ему не писал: пока водитель
 * не ввёл код, ни назначение, ни напоминание о возврате до него не дойдут.
 * Раньше пропуск оставался только строкой в журнале отправок, и о нём не знал
 * никто: автор видел предупреждение при бронировании, но сделать с ним ничего
 * не мог, а код выдаёт АХО.
 *
 * Поэтому автору этого не показывают вовсе, а карточка уходит АХО — тому, кто
 * действительно может позвонить водителю и выдать код.
 */

interface AhoPerson {
  id: string;
  entra_oid: string;
  display_name: string;
  is_active: boolean;
}

/**
 * Кому из АХО уходят карточки.
 *
 * Роль, а не конкретный человек: в требованиях такие карточки адресованы
 * Дарье, но сотрудников АХО может быть несколько, и разобраться может любой.
 */
export async function ahoRecipients(purpose: string): Promise<AhoPerson[]> {
  const { data, error } = await getDb()
    .from('employee_roles')
    .select('employees!employee_roles_employee_id_fkey(id, entra_oid, display_name, is_active)')
    .eq('role', 'aho')
    .returns<{ employees: AhoPerson | null }[]>();

  if (error) {
    console.error(`Не удалось найти сотрудников АХО для ${purpose}`, error);
    return [];
  }

  return (data ?? [])
    .map((row) => row.employees)
    .filter((person): person is AhoPerson => person !== null && person.is_active);
}

interface TripRow {
  id: number;
  starts_at: string;
  ends_at: string;
  route: string;
}

export interface UndeliveredInfo {
  tripId: number;
  driverId: string;
  driverName: string;
  /** Что именно не дошло, словами: «запрос подтверждения», «напоминание о возврате». */
  what: string;
}

/**
 * Отметить пропуск и сказать об этом АХО.
 *
 * Вызывается вместо `skipDelivery` везде, где получатель — водитель без
 * привязанного Telegram. Ключ защиты от повтора свой на каждое сообщение:
 * одна и та же поездка может не дойти и назначением, и напоминанием, и о
 * каждом стоит знать отдельно.
 */
export async function skipDriverDelivery(
  entry: OutboxEntry,
  info: UndeliveredInfo,
): Promise<void> {
  await skipDelivery(entry, 'У водителя не подключён Telegram');

  try {
    const { data: trip } = await getDb()
      .from('trips')
      .select('id, starts_at, ends_at, route')
      .eq('id', info.tripId)
      .maybeSingle<TripRow>();

    if (!trip) {
      return;
    }

    const label = tripLabelFrom(trip.id, trip.starts_at, trip.ends_at);
    const card = cardUndelivered(label, trip.id, trip.route, info.driverName, info.what);
    const recipients = await ahoRecipients('недоставленное водителю');

    await Promise.all(
      recipients.map((person) =>
        deliverOnce(
          {
            template: 'AHO_UNDELIVERED',
            channel: 'teams',
            tripId: info.tripId,
            recipient: { employeeId: person.id },
            dedupeKey: `UNDELIVERED:${entry.template}:trip:${info.tripId}:driver:${info.driverId}:employee:${person.id}`,
          },
          () => sendCard(person.id, person.entra_oid, card),
        ),
      ),
    );
  } catch (error) {
    // Пропуск уже записан, и это главное: поездка идёт своим ходом, а АХО
    // увидит состояние водителя в карточке поездки.
    console.error(`Поездка #${info.tripId}: АХО не узнала о недоставленном`, error);
  }
}
