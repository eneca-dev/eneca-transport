import 'server-only';

import { sendTelegramMessage } from '@/lib/bots/telegram';
import { messageT6 } from '@/lib/bots/telegramMessages';
import { getDb } from '@/config/supabase';
import { deliverOnce, skipDelivery } from '@/modules/notifications/outbox';

import { askReturnStep } from './driverReturn';

/** Т5 и Т6 водителю: начало возврата по сроку и сообщение о закрытии. */

interface DriverRow {
  driver_id: string | null;
  distance_km: number | null;
  drivers: { telegram_chat_id: number | null } | null;
}

const SELECT = 'driver_id, distance_km, drivers(telegram_chat_id)';

async function loadDriver(tripId: number): Promise<DriverRow | null> {
  const { data, error } = await getDb()
    .from('trips')
    .select(SELECT)
    .eq('id', tripId)
    .maybeSingle<DriverRow>();

  if (error) {
    console.error(`Поездка #${tripId}: не удалось прочитать водителя`, error);
    return null;
  }
  return data;
}

/**
 * Т5: пора оформить возврат.
 *
 * Отправляется планировщиком в плановое время возврата. Текст и кнопки берутся
 * у того же шагового механизма, что отвечает на сообщения водителя — иначе
 * напоминание и разговор разошлись бы.
 */
export async function notifyDriverReturnDue(tripId: number): Promise<void> {
  const trip = await loadDriver(tripId);

  if (!trip?.driver_id) {
    return;
  }

  const entry = {
    template: 'T5',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId: trip.driver_id },
    dedupeKey: `T5:trip:${tripId}`,
  };

  const chatId = trip.drivers?.telegram_chat_id ?? null;

  if (chatId === null) {
    await skipDelivery(entry, 'У водителя не подключён Telegram');
    return;
  }

  const reply = await askReturnStep(trip.driver_id);

  if (!reply) {
    return;
  }

  await deliverOnce(entry, () =>
    sendTelegramMessage(chatId, reply.text, {
      buttons: reply.buttons,
      withKeyboard: reply.buttons === undefined,
    }),
  );
}

/** Т6: поездка закрыта. */
export async function notifyDriverTripClosed(tripId: number): Promise<void> {
  const trip = await loadDriver(tripId);

  if (!trip?.driver_id) {
    return;
  }

  const entry = {
    template: 'T6',
    channel: 'telegram' as const,
    tripId,
    recipient: { driverId: trip.driver_id },
    dedupeKey: `T6:trip:${tripId}`,
  };

  const chatId = trip.drivers?.telegram_chat_id ?? null;

  if (chatId === null) {
    await skipDelivery(entry, 'У водителя не подключён Telegram');
    return;
  }

  await deliverOnce(entry, () =>
    sendTelegramMessage(chatId, messageT6(tripId, trip.distance_km ?? 0), {
      withKeyboard: true,
    }),
  );
}
