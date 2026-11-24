import { formatDayRange } from '@/lib/datetime';

/**
 * Название поездки: «Гомель/01.12».
 *
 * Люди узнают поездку не по номеру, а по «куда и когда», поэтому название —
 * главное, а номер остаётся технической ссылкой для документов и для разговора
 * с АХО.
 *
 * Название **не хранится**: оно собирается из текущего маршрута и дат каждый
 * раз. Поэтому после переноса оно само становится верным. Хранить его было бы
 * ошибкой — номер печатается в документах и меняться не может, а «куда и когда»
 * меняется переносом и правкой маршрута.
 *
 * Отсюда же следует, что название не уникально: две поездки в Гомель на
 * 01.12 выглядят одинаково. Там, где нужно сослаться однозначно, рядом стоит
 * номер.
 *
 * Обращений к базе здесь нет намеренно: разбор маршрута — это работа с текстом,
 * который человек вводит руками, и проверяться она должна без приложения.
 */

/**
 * Чем разделены точки маршрута.
 *
 * Дефис считается разделителем только в окружении пробелов: иначе
 * «Санкт-Петербург» распался бы на две точки. По той же причине нет короткого
 * тире без пробелов — в «05–06.11» оно означает диапазон.
 */
const SEPARATOR = /\s*(?:→|->|=>|⇒|,|;|\s[—–-]\s)\s*/;

/** Длиннее этого название не читается в строке списка. */
const MAX_LENGTH = 22;

function shorten(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toLocaleUpperCase('ru') + text.slice(1);
}

/**
 * Куда поездка. Из «Минск → Гомель → Минск» — «Гомель».
 *
 * Точка отправления отбрасывается: она почти всегда Минск и ничего не говорит.
 * Возврат в неё же — тоже. Если промежуточных точек несколько, берётся первая
 * и приписка, сколько ещё: «Гомель +1».
 */
export function destination(route: string): string {
  const parts = route
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return 'Поездка';
  }
  // Маршрут без разделителей — свободный текст вида «Объект в Гомельской обл.».
  // Разобрать его не на что, показываем как написано.
  if (parts.length === 1) {
    return shorten(capitalize(parts[0]));
  }

  const origin = parts[0].toLocaleLowerCase('ru');
  let middle = parts.slice(1);

  // Круговой маршрут: последняя точка совпадает с первой.
  if (middle.length > 1 && middle[middle.length - 1].toLocaleLowerCase('ru') === origin) {
    middle = middle.slice(0, -1);
  }

  // Повторы подряд («Минск → Гомель → Гомель») ничего не добавляют.
  const unique = middle.filter(
    (part, index) =>
      index === 0 || part.toLocaleLowerCase('ru') !== middle[index - 1].toLocaleLowerCase('ru'),
  );

  if (unique.length === 0) {
    return shorten(capitalize(parts[0]));
  }

  const first = capitalize(unique[0]);
  return unique.length === 1 ? shorten(first) : `${shorten(first)} +${unique.length - 1}`;
}

/** «Гомель/01.12» или «Брест/01–03.12» для многодневной. */
export function tripLabel(route: string, startsAt: Date, endsAt: Date): string {
  return `${destination(route)}/${formatDayRange(startsAt, endsAt)}`;
}

/** То же от строк из базы — так зовут почти все карточки и сообщения. */
export function tripLabelFrom(route: string, startsAt: string, endsAt: string): string {
  return tripLabel(route, new Date(startsAt), new Date(endsAt));
}

/**
 * Как поездка называется в сообщениях: название, номер и маршрут вместе.
 *
 * Собрано в одну величину, чтобы сообщения ботов не пересобирали её каждое
 * по-своему: разъедутся — и водитель с рецепцией будут звать одну поездку
 * по-разному.
 */
export interface TripRef {
  label: string;
  tripId: number;
  route: string;
}

interface TripRefRow {
  id: number;
  route: string;
  starts_at: string;
  ends_at: string;
}

export function tripRef(trip: TripRefRow): TripRef {
  return {
    label: tripLabelFrom(trip.route, trip.starts_at, trip.ends_at),
    tripId: trip.id,
    route: trip.route,
  };
}
