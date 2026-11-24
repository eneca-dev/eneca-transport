import { screenDeepLink, tripDeepLink } from '@/config/app';
import { formatPeriod } from '@/lib/datetime';

import type { TabScreen } from '@/config/app';

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

/** Строка выпадающего списка: машина или водитель. */
export interface CardChoice {
  id: string;
  label: string;
}

/**
 * Выпадающий список в карточке.
 *
 * Список свободных машин или водителей считается в момент отправки. Пока
 * карточка лежит в чате, выбранного могут занять — тогда служба откажет с
 * причиной, как на третьем шаге Э2. Это не ошибка карточки, а обычный ход.
 */
interface CardChoiceInput {
  id: string;
  label: string;
  placeholder: string;
  choices: CardChoice[];
}

interface CardOptions {
  title: string;
  /** Короткая строка под заголовком: даты и маршрут. */
  subtitle?: string;
  facts: CardFact[];
  /** Текст после полей — объяснение или просьба. */
  note?: string;
  /** Выпадающий список после текста. */
  choice?: CardChoiceInput;
  actions?: CardAction[];
}

export type CardAction =
  | { kind: 'open'; title: string; tripId: number }
  /** Вкладка целиком или её экран: `screen` не задан — начало вкладки. */
  | { kind: 'screen'; title: string; screen?: TabScreen }
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
  if (action.kind === 'screen') {
    return {
      type: 'Action.OpenUrl',
      title: action.title,
      url: screenDeepLink(action.screen),
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
export function buildCard({
  title,
  subtitle,
  facts,
  note,
  choice,
  actions,
}: CardOptions): unknown {
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

  if (choice && choice.choices.length > 0) {
    body.push({
      type: 'Input.ChoiceSet',
      id: choice.id,
      label: choice.label,
      placeholder: choice.placeholder,
      // Выбор обязателен: без него нажатие означало бы «назначить первого в
      // списке», чего человек не выбирал. Сервер проверяет это ещё раз.
      isRequired: true,
      errorMessage: 'Выберите из списка',
      choices: choice.choices.map((item) => ({ title: item.label, value: item.id })),
    });
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
    actions: [
      { kind: 'open', title: 'Открыть', tripId: trip.id },
      {
        // Кнопка не отменяет сразу: в ответ приходит вопрос отдельной
        // карточкой. Отмена освобождает бронь и рассылает К12 и Т4 — делать
        // это от одного случайного нажатия в чате нельзя.
        kind: 'submit',
        title: 'Отменить',
        style: 'destructive',
        data: { action: 'trip_cancel_ask', tripId: trip.id },
      },
    ],
  });
}

/**
 * Вопрос перед отменой: приходит в ответ на «Отменить» в К1.
 *
 * Отдельной карточкой, а не вложенной: вложенные карточки и скрытые блоки в
 * Teams ведут себя по-разному в разных клиентах, а замена карточки у нас уже
 * работает и проверена. Прежняя карточка остаётся на месте — случайное
 * нажатие ничего не меняет.
 */
export function cardCancelConfirm(
  tripId: number,
  startsAt: string,
  endsAt: string,
  route: string,
): unknown {
  return buildCard({
    title: `Отменить поездку #${tripId}?`,
    subtitle: `${formatPeriod(new Date(startsAt), new Date(endsAt))} · ${route}`,
    facts: [],
    note:
      'Машина и водитель освободятся, участники, рецепция и финотдел получат уведомление. ' +
      'Вернуть отменённую заявку нельзя — её придётся оформить заново.',
    actions: [
      {
        kind: 'submit',
        title: 'Да, отменить',
        style: 'destructive',
        data: { action: 'trip_cancel', tripId },
      },
      {
        kind: 'submit',
        title: 'Оставить',
        data: { action: 'trip_cancel_abort', tripId },
      },
    ],
  });
}

/**
 * К3: финотделу — новая или изменённая заявка.
 *
 * Кнопка «Документы готовы» прямо в карточке: по требованиям финотдел
 * отмечает готовность, и заставлять его для этого открывать вкладку —
 * лишний шаг на каждой заявке.
 */
export function cardK3(trip: TripCardData, recheck: boolean, changes: string[] = []): unknown {
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
    // Перечень изменений в карточке, а не только во вкладке: финотдел должен
    // понимать, что перепроверять, не открывая приложение.
    note: recheck
      ? [
          'Прежний комплект документов неактуален.',
          ...(changes.length > 0 ? ['', 'Изменилось:', ...changes.map((line) => `• ${line}`)] : []),
        ].join('\n')
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
        type: 'TextBlock',
        text: 'Всё в порядке с машиной?',
        weight: 'Bolder',
        wrap: true,
        spacing: 'Medium',
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
    // Две кнопки вместо переключателя и «Отправить», как в требованиях: «Да,
    // Есть замечание, Отправить». Ответ о состоянии машины приходит в данных
    // нажатой кнопки, а поля карточки Teams присылает вместе с ними — поэтому
    // одометр и примечание отправляются тем же нажатием.
    actions: [
      {
        type: 'Action.Submit',
        title: 'Да, всё в порядке',
        style: 'positive',
        data: { action: 'trip_return', tripId: trip.id, condition: 'ok' },
      },
      {
        type: 'Action.Submit',
        title: 'Есть замечание',
        data: { action: 'trip_return', tripId: trip.id, condition: 'remark' },
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
    // Имени сотрудника в тексте нет намеренно: человек на рецепции меняется,
    // а сообщения остаются. То же правило, что с адресатом К14 — роль, не имя.
    note: 'Документы и ключи — на рецепции перед выездом.',
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
        url: screenDeepLink('reception'),
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

/** Чем затронута бронь: машину забрали в ремонт или водитель стал недоступен. */
export interface BookingAffected {
  kind: 'car' | 'driver';
  /** Свободные на эти даты машины или водители — посчитаны при отправке. */
  free: CardChoice[];
  /**
   * Список посчитать не удалось. Тогда нельзя писать «свободных нет»: человек
   * перестанет искать замену, хотя она может быть.
   */
  unknownFree?: boolean;
}

/**
 * К13: автору и АХО — бронь затронута.
 *
 * Машину отправили в ремонт или водитель стал недоступен на эти даты. Бронь
 * при этом сохраняется: решение за человеком, а не за системой.
 *
 * Замена выбирается прямо здесь, как требуют требования («Выбрать другую» и
 * «Назначить водителя»). Список свободных считается при отправке: машин и
 * водителей у компании единицы, и выпадающий список из трёх строк читается
 * даже на телефоне. Водителя назначает только АХО — автору в этом случае
 * остаётся «Открыть».
 */
export function cardK13(
  trip: TripCardData,
  reason: string,
  forAho: boolean,
  affected: BookingAffected,
): unknown {
  const mayChoose = affected.kind === 'car' || forAho;
  const canChoose = mayChoose && affected.free.length > 0;

  const note = ((): string => {
    if (canChoose) {
      return affected.kind === 'car'
        ? 'Выберите другую машину из списка — бронь переедет на неё.'
        : 'Назначьте другого водителя из списка — ему уйдёт запрос подтверждения.';
    }
    if (mayChoose && affected.unknownFree) {
      return 'Кто свободен на эти даты — видно в заявке. Поездку можно также перенести или отменить.';
    }
    if (mayChoose) {
      return affected.kind === 'car'
        ? 'Свободных машин на эти даты нет. Откройте заявку — поездку можно перенести или отменить.'
        : 'Свободных водителей на эти даты нет. Откройте заявку — поездку можно перенести или отменить.';
    }
    return 'Другого водителя назначит АХО. Откройте заявку, если поездку нужно перенести или отменить.';
  })();

  const actions: CardAction[] = [];

  if (canChoose) {
    actions.push(
      affected.kind === 'car'
        ? {
            kind: 'submit',
            title: 'Выбрать другую',
            style: 'positive',
            data: { action: 'car_change', tripId: trip.id },
          }
        : {
            kind: 'submit',
            title: 'Назначить водителя',
            style: 'positive',
            data: { action: 'driver_assign', tripId: trip.id },
          },
    );
  }

  actions.push({ kind: 'open', title: 'Открыть', tripId: trip.id });

  return buildCard({
    title: `Поездка #${trip.id}: бронь затронута`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Что случилось', value: reason },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
      { title: 'Водитель', value: trip.driverLabel ?? 'без водителя' },
      { title: 'Автор', value: trip.authorName },
    ],
    note,
    choice: canChoose
      ? affected.kind === 'car'
        ? {
            id: 'carId',
            label: 'Свободные машины на эти даты',
            placeholder: 'Выберите машину',
            choices: affected.free,
          }
        : {
            id: 'driverId',
            label: 'Свободные водители на эти даты',
            placeholder: 'Выберите водителя',
            choices: affected.free,
          }
      : undefined,
    actions,
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
    note:
      'Бронь автомобиля сохраняется, пока вы не решили. ' +
      'Поедете без водителя или отменить поездку?',
    actions: [
      {
        kind: 'submit',
        // Название из требований. «Поеду сам» было понятнее как решение, но
        // в журнале, в К12 и в Э3 это состояние называется «без водителя», и
        // два названия одного и того же читались как разные вещи.
        title: 'Без водителя',
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

/**
 * Приветствие при установке и ответ на любое сообщение человека.
 *
 * Бот не ведёт переписку: заявки оформляются во вкладке. Но отвечать на
 * «здравствуйте» стеной текста «идите во вкладку» — значит оставить человека
 * искать её самому. Поэтому ответ — кнопки, которые открывают вкладку сразу
 * на нужном экране.
 *
 * Переключить вкладку за человека бот не может: в Teams такого нет. Нажатие
 * на кнопку — единственный способ его туда перенести.
 *
 * Кнопок по ролям: у человека без роли две, у АХО пять. Больше шести Teams
 * сворачивает в «…», поэтому разделы, до которых и так есть меню внутри
 * вкладки, здесь не повторяются.
 */
export function cardWelcome(knownEmployee: boolean, roles: readonly string[]): unknown {
  const has = (role: string): boolean => roles.includes(role);

  const actions: CardAction[] = [
    { kind: 'screen', title: 'Новая поездка', screen: 'new' },
    { kind: 'screen', title: 'Мои поездки' },
  ];

  if (has('reception') || has('aho')) {
    actions.push({ kind: 'screen', title: 'Рецепция', screen: 'reception' });
  }
  if (has('finance') || has('aho')) {
    actions.push({ kind: 'screen', title: 'Документы', screen: 'documents' });
  }
  if (has('aho')) {
    actions.push({ kind: 'screen', title: 'Календарь', screen: 'calendar' });
  }

  const note = [
    'Сюда приходят бронь, готовность документов, выдача ключей и возврат. Отвечать мне не нужно.',
    '',
    'Заявки оформляются во вкладке — кнопки ниже открывают её сразу на нужном экране.',
  ];

  // Справочник сотрудников обновляется раз в сутки. Пока человека в нём нет,
  // карточки до него не дойдут, и знать об этом лучше сразу.
  if (!knownEmployee) {
    note.push(
      '',
      'Вас пока нет в справочнике сотрудников — он обновляется раз в сутки. Если карточки не приходят и завтра, напишите в АХО.',
    );
  }

  return buildCard({
    title: 'Командировки и служебные машины',
    facts: [],
    note: note.join('\n'),
    actions,
  });
}

/** Строка списка поездок в ответе бота на команду «Мои поездки». */
export interface TripLine {
  id: number;
  period: string;
  route: string;
  state: string;
  /** Что требуется от того, кто спросил. `null` — ждут не его. */
  waitingFor: string | null;
}

/**
 * Ответ на команду «Мои поездки».
 *
 * Бот отвечает списком, а не кнопкой «откройте вкладку»: человек спросил
 * «что у меня», и ответ должен быть ответом. Подробности и действия — во
 * вкладке, ссылка на неё внизу.
 *
 * Показываются первые несколько: карточка на двадцать поездок не читается, а
 * прокрутки в чате у неё нет.
 */
export function cardMyTrips(lines: TripLine[], hidden: number): unknown {
  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: lines.length > 0 ? 'Ваши поездки' : 'Поездок за вами нет',
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
  ];

  if (lines.length === 0) {
    body.push({
      type: 'TextBlock',
      text: 'Оформить заявку можно во вкладке — кнопка ниже.',
      wrap: true,
      isSubtle: true,
    });
  }

  for (const line of lines) {
    body.push({
      type: 'TextBlock',
      text: `**#${line.id}** · ${line.period}`,
      wrap: true,
      spacing: 'Medium',
    });
    body.push({
      type: 'TextBlock',
      text: `${line.route} · ${line.state}`,
      wrap: true,
      isSubtle: true,
      spacing: 'None',
    });

    if (line.waitingFor) {
      body.push({
        type: 'TextBlock',
        text: `От вас: ${line.waitingFor}`,
        wrap: true,
        spacing: 'None',
      });
    }
  }

  if (hidden > 0) {
    body.push({
      type: 'TextBlock',
      text: `И ещё ${hidden} — в разделе «Мои поездки».`,
      wrap: true,
      isSubtle: true,
      spacing: 'Medium',
    });
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: CARD_VERSION,
    body,
    actions: [
      toAction({ kind: 'screen', title: 'Открыть список' }),
      toAction({ kind: 'screen', title: 'Новая поездка', screen: 'new' }),
    ],
  };
}

/** Ответ на команду «Новая поездка». */
export function cardNewTrip(): unknown {
  return buildCard({
    title: 'Новая поездка',
    facts: [],
    note:
      'Заявка оформляется во вкладке: три шага — данные поездки, выбор машины и водителя, ' +
      'проверка. Открыть её за вас я не могу, в Teams такого нет — нажмите кнопку.',
    actions: [{ kind: 'screen', title: 'Открыть форму заявки', screen: 'new' }],
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
 * К14: АХО — водитель отказался или не подтвердил за 15 минут.
 *
 * Молчание и отказ — разные случаи, и решения у них разные. Отказ окончателен:
 * нужен другой водитель. Молчание чаще всего значит, что водитель за рулём, и
 * АХО решает его звонком — поэтому у молчания есть кнопка «Подтвердить за
 * водителя», а у отказа её нет.
 *
 * Выбор водителя на месте карточка не предлагает: список свободных водителей
 * в адаптивной карточке нечитаем на телефоне. Бронь автомобиля сохраняется, об
 * этом сказано прямо в карточке, чтобы АХО не бросилась бронировать заново.
 */
export function cardK14(
  trip: TripCardData,
  driverName: string,
  reason: 'declined' | 'timeout',
): unknown {
  const actions: CardAction[] = [];

  if (reason === 'timeout') {
    actions.push({
      kind: 'submit',
      title: 'Подтвердить за водителя',
      data: { action: 'driver_confirm_aho', tripId: trip.id },
      style: 'positive',
    });
  }

  actions.push({ kind: 'open', title: 'Назначить другого', tripId: trip.id });

  return buildCard({
    title:
      reason === 'declined'
        ? `Поездка #${trip.id}: водитель отказался`
        : `Поездка #${trip.id}: от водителя нет ответа`,
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
    note:
      reason === 'declined'
        ? 'Бронь автомобиля сохранена — нужно назначить другого водителя.'
        : 'Бронь автомобиля сохранена. Водитель всё ещё может подтвердить сам — ' +
          'кнопки у него в боте работают.',
    actions,
  });
}

/**
 * АХО: водитель подтвердил сам, уже после 15 минут.
 *
 * Отправляется только тем, кто получил К14: иначе АХО ищет замену человеку,
 * который тем временем согласился ехать.
 */
export function cardDriverLateConfirm(trip: TripCardData, driverName: string): unknown {
  return buildCard({
    title: `Поездка #${trip.id}: водитель подтвердил`,
    subtitle: `${period(trip)} · ${trip.route}`,
    facts: [
      { title: 'Водитель', value: driverName },
      { title: 'Что случилось', value: 'ответил позже 15 минут' },
      { title: 'Машина', value: trip.carLabel ?? 'не выбрана' },
    ],
    note: 'Замена больше не нужна.',
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
