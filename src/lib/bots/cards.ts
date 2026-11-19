import { tripDeepLink } from '@/config/app';
import { formatPeriod } from '@/lib/datetime';

/**
 * Адаптивные карточки Teams-бота (К1–К16).
 *
 * Кнопки — только `Action.Submit` и `Action.OpenUrl`. `Action.Execute`
 * использовать нельзя: ответ на invoke через `processActivityDirect` не
 * возвращается, и карточка зависает в состоянии «загрузка».
 *
 * Структуру держим единообразной: заголовок, строки «ключ — значение»,
 * кнопки. Так шестнадцать карточек выглядят как одно приложение, а не как
 * шестнадцать разных.
 */

const CARD_VERSION = '1.4';

export interface CardFact {
  title: string;
  value: string;
}

interface CardOptions {
  title: string;
  /** Короткая строка под заголовком: даты и маршрут. */
  subtitle?: string;
  facts: CardFact[];
  /** Текст после полей — объяснение или просьба. */
  note?: string;
  actions?: CardAction[];
}

export type CardAction =
  | { kind: 'open'; title: string; tripId: number }
  | { kind: 'submit'; title: string; data: Record<string, unknown>; style?: 'positive' | 'destructive' };

function toAction(action: CardAction): Record<string, unknown> {
  if (action.kind === 'open') {
    return {
      type: 'Action.OpenUrl',
      title: action.title,
      url: tripDeepLink(action.tripId),
    };
  }
  return {
    type: 'Action.Submit',
    title: action.title,
    style: action.style,
    data: action.data,
  };
}

/** Общий каркас карточки. */
export function buildCard({ title, subtitle, facts, note, actions }: CardOptions): unknown {
  const body: Record<string, unknown>[] = [
    { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
  ];

  if (subtitle) {
    body.push({ type: 'TextBlock', text: subtitle, isSubtle: true, wrap: true, spacing: 'None' });
  }

  if (facts.length > 0) {
    body.push({ type: 'FactSet', facts });
  }

  if (note) {
    body.push({ type: 'TextBlock', text: note, wrap: true });
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: CARD_VERSION,
    body,
    actions: (actions ?? []).map(toAction),
  };
}

/** Данные поездки, из которых собираются карточки. */
export interface TripCardData {
  id: number;
  startsAt: string;
  endsAt: string;
  route: string;
  contract: string;
  purpose: string;
  carLabel: string | null;
  driverLabel: string | null;
  authorName: string;
  participantNames: string[];
}

function period(trip: TripCardData): string {
  return formatPeriod(new Date(trip.startsAt), new Date(trip.endsAt));
}

/** К1: автору, бронь создана. */
export function cardK1(trip: TripCardData): unknown {
  return buildCard({
    title: `Поездка #${trip.id} забронирована`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
      { title: 'Договор', value: trip.contract },
      {
        title: 'Участники',
        value:
          trip.participantNames.length > 0 ? trip.participantNames.join(', ') : 'только вы',
      },
    ],
    note: trip.driverLabel
      ? 'Водителю отправлен запрос подтверждения. Документы подготовит финотдел, ключи заберёте на рецепции перед выездом.'
      : 'Документы подготовит финотдел, ключи заберёте на рецепции перед выездом.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К16: автору — к выезду нет подтверждённого водителя.
 *
 * Два решения: ехать самому или отменить. До выбора бронь автомобиля
 * сохраняется, об этом сказано в карточке: иначе человек думает, что уже всё
 * потеряно, и бронирует заново.
 */
export function cardK16(trip: TripCardData, driverState: string): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: водителя нет`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: `${trip.driverLabel ?? 'не назначен'} — ${driverState}` },
    ],
    note: 'Бронь автомобиля сохраняется, пока вы не решили. Поедете сами или отменить поездку?',
    actions: [
      {
        kind: 'submit',
        title: 'Поеду сам',
        style: 'positive',
        data: { action: 'trip_without_driver', tripId: trip.id },
      },
      {
        kind: 'submit',
        title: 'Отменить поездку',
        style: 'destructive',
        data: { action: 'trip_cancel', tripId: trip.id },
      },
      { kind: 'open', title: 'Открыть', tripId: trip.id },
    ],
  });
}

/** Карточка после нажатия: результат и время, кнопок больше нет. */
export function cardDone(title: string, facts: CardFact[], result: string): unknown {
  return buildCard({
    title,
    facts,
    note: result,
  });
}

/**
 * К14: Дарье (АХО) — водитель отказался или не подтвердил за 15 минут.
 *
 * Кнопки «Назначить водителя» пока нет: замена водителя — это И7. Бронь
 * автомобиля при этом сохраняется, об этом сказано прямо в карточке, чтобы АХО
 * не бросилась бронировать заново.
 */
export function cardK14(
  trip: TripCardData,
  driverName: string,
  reason: 'declined' | 'timeout',
): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: водитель не подтвердил`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Водитель', value: driverName },
      {
        title: 'Что случилось',
        value: reason === 'declined' ? 'отказался' : 'не ответил за 15 минут',
      },
      { title: 'Автор заявки', value: trip.authorName },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
    ],
    note: 'Бронь автомобиля сохранена — нужно назначить другого водителя.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/** К2: участнику, его добавили в поездку. */
export function cardK2(trip: TripCardData): unknown {
  const people = [trip.authorName, ...trip.participantNames].join(', ');

  return buildCard({
    title: `Вас добавили в поездку #${trip.id}`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Едут', value: people },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
      { title: 'Цель', value: trip.purpose },
    ],
    note: 'Заявку оформил автор поездки — изменить её можно только через него или АХО.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}
