import { screenDeepLink, tripDeepLink } from '@/config/app';
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
  | {
      kind: 'submit';
      title: string;
      data: Record<string, unknown>;
      style?: 'positive' | 'destructive';
    };

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
        value: trip.participantNames.length > 0 ? trip.participantNames.join(', ') : 'только вы',
      },
    ],
    note: trip.driverLabel
      ? 'Водителю отправлен запрос подтверждения. Документы подготовит финотдел, ключи заберёте на рецепции перед выездом.'
      : 'Документы подготовит финотдел, ключи заберёте на рецепции перед выездом.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К3: финотделу — новая или изменённая заявка.
 *
 * Кнопка «Документы готовы» прямо в карточке: по требованиям финотдел
 * отмечает готовность, и заставлять его для этого открывать вкладку —
 * лишний шаг на каждой заявке.
 */
export function cardK3(trip: TripCardData, recheck: boolean): unknown {
  return buildCard({
    title: recheck
      ? `Поездка #${trip.id} изменилась — нужна повторная проверка`
      : `Новая заявка #${trip.id}`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      {
        title: 'Участники',
        value: [trip.authorName, ...trip.participantNames].join(', '),
      },
      { title: 'Договор', value: trip.contract },
      { title: 'Цель', value: trip.purpose },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
    ],
    note: recheck
      ? 'Прежний комплект документов неактуален — проверьте и подтвердите готовность заново.'
      : undefined,
    actions: [
      {
        kind: 'submit',
        title: 'Документы готовы',
        style: 'positive',
        data: { action: 'docs_ready', tripId: trip.id },
      },
      { kind: 'open', title: 'Открыть', tripId: trip.id },
    ],
  });
}

/**
 * К7: автору — ключи выданы.
 *
 * Без кнопок: по требованиям это уведомление, а не запрос действия. Главное
 * в нём — срок возврата, поэтому он в заголовке, а не в полях.
 */
export function cardK7(trip: TripCardData, returnBy: string, odometerStartKm: number): unknown {
  return buildCard({
    title: `Хорошей поездки. Вернуть ключи до ${returnBy}`,
    subtitle: `Поездка #${trip.id} · ${trip.route}`,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
      {
        title: 'Одометр при выдаче',
        value: `${odometerStartKm.toLocaleString('ru-RU')} км`,
      },
    ],
    note: 'При возврате понадобится показание одометра — запишите его перед сдачей ключей.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/** К4: автору — документы готовы. */
export function cardK4(trip: TripCardData): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: документы готовы`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
    ],
    note: 'Заберите документы и ключи на рецепции перед выездом.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К8: автору поездки без водителя — пора оформить возврат.
 *
 * Поля прямо в карточке: по требованиям здесь одометр, «всё в порядке?» и
 * примечание. Человеку не нужно открывать вкладку, чтобы сдать машину, —
 * он отвечает там, где получил напоминание.
 *
 * Значения полей Teams присылает вместе с данными кнопки, поэтому отдельно
 * их передавать не надо.
 */
export function cardK8(trip: TripCardData, odometerStartKm: number): unknown {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: CARD_VERSION,
    body: [
      {
        type: 'TextBlock',
        text: `Поездка #${trip.id}: время возврата`,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `${period(trip)} · ${trip.route}`,
        isSubtle: true,
        wrap: true,
        spacing: 'None',
      },
      {
        type: 'Input.Text',
        id: 'odometer',
        label: 'Показание одометра, км',
        placeholder: String(odometerStartKm),
        style: 'tel',
      },
      {
        type: 'TextBlock',
        text: `При выдаче было ${odometerStartKm.toLocaleString('ru-RU')} км`,
        isSubtle: true,
        wrap: true,
        spacing: 'None',
      },
      {
        type: 'Input.ChoiceSet',
        id: 'condition',
        label: 'Всё в порядке с машиной?',
        style: 'expanded',
        value: 'ok',
        choices: [
          { title: 'Да', value: 'ok' },
          { title: 'Есть замечание', value: 'remark' },
        ],
      },
      {
        type: 'Input.Text',
        id: 'note',
        label: 'Примечание',
        placeholder: 'мусор, забытые вещи, повреждения — необязательно',
        isMultiline: true,
      },
      {
        type: 'TextBlock',
        text: 'После отправки сдайте ключи на рецепции — поездка закроется, когда их примут.',
        isSubtle: true,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: 'Отправить',
        style: 'positive',
        data: { action: 'trip_return', tripId: trip.id },
      },
    ],
  };
}

/** К5: автору — накануне выезда, 17:00. */
export function cardK5(trip: TripCardData, departure: string): unknown {
  return buildCard({
    title: `Завтра поездка #${trip.id}`,
    subtitle: trip.route,
    facts: [
      { title: 'Выезд', value: departure },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
    ],
    note: 'Документы и ключи — у Виктории на рецепции перед выездом.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К6: рецепции — утренняя сводка.
 *
 * Не про одну поездку, поэтому вместо полей — цифры по дню. Открывать по
 * одной карточке на каждую выдачу значит завалить рецепцию с утра.
 */
export function cardK6(counts: { issues: number; returns: number; overdue: number }): unknown {
  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: 'Рецепция: что сегодня',
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Выдать', value: String(counts.issues) },
        { title: 'Принять', value: String(counts.returns) },
        { title: 'Просрочено', value: String(counts.overdue) },
      ],
    },
  ];

  if (counts.overdue > 0) {
    body.push({
      type: 'TextBlock',
      text: 'Есть незакрытые поездки с прошлых дней — они в отдельном списке на экране.',
      wrap: true,
    });
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: CARD_VERSION,
    body,
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Открыть экран рецепции',
        url: screenDeepLink(),
      },
    ],
  };
}

/** К15: автору и АХО — ключи не сданы. */
export function cardK15(trip: TripCardData, returnBy: string): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: ключи не сданы`,
    subtitle: trip.route,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? '—' },
      { title: 'Вернуть надо было', value: returnBy },
      { title: 'Ответственный', value: trip.authorName },
    ],
    note: 'Машина числится занятой, пока ключи не приняты на рецепции.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/** Что случилось с заявкой — для К12 и Т4. */
export type TripChange = 'rescheduled' | 'cancelled' | 'driver_changed' | 'data_changed';

export const CHANGE_LABEL: Record<TripChange, string> = {
  rescheduled: 'перенесена',
  cancelled: 'отменена',
  driver_changed: 'сменился водитель',
  data_changed: 'изменены данные',
};

/**
 * К12: всем участникам поездки — заявка изменилась.
 *
 * Одна карточка на все случаи: отмену, перенос и правку данных. Разные
 * карточки на каждое изменение означали бы четыре почти одинаковых текста,
 * которые разъедутся при первой же правке.
 */
export function cardK12(
  trip: TripCardData,
  change: TripChange,
  details: string,
  docsRecheck: boolean,
): unknown {
  return buildCard({
    title: `Поездка #${trip.id} ${CHANGE_LABEL[change]}`,
    subtitle: change === 'cancelled' ? trip.route : `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Что изменилось', value: details },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
    ],
    note: docsRecheck
      ? 'Документы отправлены на повторную проверку — финотдел подтвердит готовность заново.'
      : undefined,
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К13: автору и АХО — бронь затронута.
 *
 * Машину отправили в ремонт или водитель стал недоступен на эти даты.
 * Бронь при этом сохраняется: решение за человеком, а не за системой.
 */
export function cardK13(trip: TripCardData, reason: string, forAho: boolean): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: бронь затронута`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Что случилось', value: reason },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
      { title: 'Автор', value: trip.authorName },
    ],
    note: forAho
      ? 'Назначьте другого водителя или машину в карточке поездки.'
      : 'Выберите другую машину или водителя в карточке поездки, либо отмените заявку.',
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/** К9: автору — поездка закрыта. */
export function cardK9(trip: TripCardData, distanceKm: number, odometerEndKm: number): unknown {
  return buildCard({
    title: `Поездка #${trip.id} закрыта`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Машина', value: trip.carLabel ?? '—' },
      { title: 'Пробег', value: `${distanceKm.toLocaleString('ru-RU')} км` },
      { title: 'Одометр при сдаче', value: `${odometerEndKm.toLocaleString('ru-RU')} км` },
    ],
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К10: АХО — замечание или примечание при возврате.
 *
 * Кнопки разные по смыслу. Примечание (забытые вещи, мусор) достаточно
 * принять к сведению. Замечание по машине требует решения: в ремонт или
 * ничего страшного.
 */
export function cardK10(
  trip: TripCardData,
  author: string,
  text: string,
  isRemark: boolean,
): unknown {
  return buildCard({
    title: isRemark
      ? `Замечание по машине: ${trip.carLabel ?? '—'}`
      : `Примечание после поездки: ${trip.carLabel ?? '—'}`,
    subtitle: `Поездка #${trip.id} · ${trip.route}`,
    facts: [
      { title: 'Написал', value: author },
      { title: 'Текст', value: text || '—' },
    ],
    actions: isRemark
      ? [
          {
            kind: 'submit',
            title: 'В ремонт',
            style: 'destructive',
            data: { action: 'car_to_repair', tripId: trip.id },
          },
          {
            kind: 'submit',
            title: 'Исправлено',
            data: { action: 'remark_handled', tripId: trip.id },
          },
        ]
      : [
          {
            kind: 'submit',
            title: 'Принято',
            data: { action: 'remark_handled', tripId: trip.id },
          },
        ],
  });
}

/**
 * К11 при исправлении после закрытия: прежнее значение, новое и причина.
 *
 * Отдельная карточка от «меньше начального»: там ошибка не сохранена и дело
 * закрыто, а здесь значение изменено, и АХО должна видеть, кто и зачем.
 */
export function cardK11Correction(
  trip: TripCardData,
  correctedBy: string,
  previousKm: number,
  newKm: number,
  reason: string,
  affectedLater: number,
): unknown {
  return buildCard({
    title: `Одометр исправлен: ${trip.carLabel ?? '—'}`,
    subtitle: `Поездка #${trip.id} · ${trip.route}`,
    facts: [
      { title: 'Исправил', value: correctedBy },
      { title: 'Было', value: `${previousKm.toLocaleString('ru-RU')} км` },
      { title: 'Стало', value: `${newKm.toLocaleString('ru-RU')} км` },
      { title: 'Причина', value: reason },
    ],
    note:
      affectedLater > 0
        ? `После этой поездки у машины есть ещё ${affectedLater} закрытых поездок. ` +
          'Их показания не изменены — проверьте, не нужно ли исправить и их.'
        : undefined,
    actions: [{ kind: 'open', title: 'Открыть', tripId: trip.id }],
  });
}

/**
 * К11: АХО — показание одометра меньше начального.
 *
 * Ошибочное значение не сохраняется, поэтому карточка нужна не для решения,
 * а чтобы АХО знала: кто-то ввёл невозможное число. Повторяющиеся случаи по
 * одной машине — повод проверить сам одометр.
 */
export function cardK11(
  trip: TripCardData,
  enteredBy: string,
  startKm: number,
  enteredKm: number,
): unknown {
  return buildCard({
    title: `Одометр меньше начального: ${trip.carLabel ?? '—'}`,
    subtitle: `Поездка #${trip.id} · ${trip.route}`,
    facts: [
      { title: 'Ввёл', value: enteredBy },
      { title: 'Начальное', value: `${startKm.toLocaleString('ru-RU')} км` },
      { title: 'Введено', value: `${enteredKm.toLocaleString('ru-RU')} км` },
    ],
    note: 'Значение не сохранено, человека попросили ввести заново.',
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
