import { formatDayRange } from '@/lib/datetime';

/**
 * Название поездки: «54/23.07», «55/23–25.07» — номер заявки и дни поездки.
 *
 * Номер нужен в разговоре и в документах, дата отвечает на «какая именно»:
 * «поездка 54» ни о чём не говорит, «54/23.07» вспоминается сразу. Куда едут,
 * написано строкой ниже — маршрут длиннее заголовка и в список чатов Teams
 * целиком всё равно не влезает.
 *
 * Дата **не хранится**: она собирается из текущих дат поездки каждый раз,
 * поэтому после переноса название само становится верным. Номер при этом не
 * меняется никогда — это ключ заявки в базе.
 *
 * Разбор маршрута — функция destination — остаётся здесь же: он нужен там, где
 * коротко сказать, куда едут, — в кнопках дня у водителя и в перечне
 * мешающих броней. Обращений к базе в модуле нет намеренно: это работа с
 * текстом, который человек вводит руками, и проверяться она должна без
 * приложения.
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

/** «54/23.07» или «55/23–25.07» для многодневной. */
export function tripLabel(id: number, startsAt: Date, endsAt: Date): string {
  return `${id}/${formatDayRange(startsAt, endsAt)}`;
}

/** То же от строк из базы — так зовут почти все карточки и сообщения. */
export function tripLabelFrom(id: number, startsAt: string, endsAt: string): string {
  return tripLabel(id, new Date(startsAt), new Date(endsAt));
}

/**
 * Как поездка называется в сообщениях: название, номер и маршрут вместе.
 *
 * Собрано в одну величину, чтобы сообщения ботов не пересобирали её каждое
 * по-своему: разъедутся — и водитель с рецепцией будут звать одну поездку
 * по-разному. Номер лежит рядом отдельным полем: он нужен тем сообщениям,
 * которые ссылаются на поездку ссылкой, а не только зовут её.
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
    label: tripLabelFrom(trip.id, trip.starts_at, trip.ends_at),
    tripId: trip.id,
    route: trip.route,
  };
}
