import { URGENT_SOON_MINUTES, URGENT_TRIP_HOURS } from '@/config/app';
import { formatMoment, formatTime } from '@/lib/datetime';

/**
 * Что считать проблемой, в каком порядке и какими словами.
 *
 * Обращений к базе здесь нет намеренно: это единственное место, где записаны
 * правила срочности, и проверяться они должны без приложения. Ошибку в границе
 * «ещё впереди или уже уехали» глазами в полоске разделов не увидеть — она
 * проявится красной строкой, которая висит неделями.
 *
 * Два уровня. Спокойное дело — число: заявка в очереди, выдача во второй
 * половине дня, замечание по машине. Проблема — красная строка с названием
 * поездки. Если красить всё, красное перестаёт значить что-либо.
 *
 * Данные собирает `queries.ts` — он же приводит их к `AttentionTrip`.
 */

/** Разделы, у которых бывает число. */
export type CountedSection = 'mine' | 'reception' | 'documents' | 'cars';

export interface SectionCount {
  total: number;
  /** Сколько из них проблемы. Больше нуля — число красное. */
  urgent: number;
}

export interface ReceptionCount extends SectionCount {
  /** Готово к выдаче: документы готовы, выезд сегодня. */
  toIssue: number;
  /** Можно принять ключи: показание одометра уже передано. */
  toAccept: number;
  /** За ключами не пришли вовсе — это разбор, а не работа на сегодня. */
  stale: number;
}

/** Проблема: названа по имени, а не посчитана. */
export interface UrgentRow {
  tripId: number;
  /** «Брест/23–24.11» */
  label: string;
  /** Что случилось: «машина не вернулась». */
  what: string;
  /** Когда: «ждали 23.11 19:00». Пусто, если время ни о чём не говорит. */
  when: string | null;
  href: string;
}

/** Проблема своей поездки: показывается рамкой в строке списка, а не блоком. */
export interface OwnProblem {
  tripId: number;
  what: string;
  when: string | null;
}

export interface NavCounts {
  mine: SectionCount;
  reception: ReceptionCount;
  documents: SectionCount;
  cars: SectionCount;
  /**
   * Проблемы **чужих** поездок — красными строками на первом экране.
   *
   * Своих здесь нет намеренно: они видны рамкой в строке списка, а две записи
   * об одной поездке на одном экране — повтор.
   *
   * Не больше трёх: длинный список срочного — уже не список срочного.
   */
  urgent: UrgentRow[];
  /** Проблемы своих поездок — для рамки в строке списка. */
  own: OwnProblem[];
}

/** Минимум о поездке, нужный для решения. */
export interface AttentionTrip {
  id: number;
  /** Название вида «Гомель/01.12» — собрано тем же `tripLabel`. */
  label: string;
  startsAt: string;
  endsAt: string;
  carId: string | null;
  status: string;
  needsDriver: boolean;
  driverConfirmation: string;
  /** Документы готовы и не требуют повторной проверки. */
  docsReady: boolean;
  /** Были готовы и устарели после изменения заявки. */
  docsRecheck: boolean;
  keysIssued: boolean;
  odometerEndKm: number | null;
}

/** Дела рецепции, уже разложенные запросом по смыслу. */
export interface ReceptionInput {
  /** Выезды сегодня, ключи не выданы. */
  issues: AttentionTrip[];
  /** Плановый возврат сегодня. */
  returns: AttentionTrip[];
  /** Привезли раньше планового дня, показание передано. */
  early: AttentionTrip[];
  /** Плановый возврат прошёл, ключи не сданы. */
  overdue: AttentionTrip[];
  /** За ключами не пришли: выезд был раньше сегодняшнего дня. */
  stale: number;
}

export interface AttentionInput {
  now: Date;
  /** `null` — раздел человеку не виден, считать нечего. */
  reception: ReceptionInput | null;
  /** Очередь документов. `null` — раздел не виден. */
  documents: AttentionTrip[] | null;
  /** Незакрытые замечания по машинам. Только у АХО. */
  remarks: number;
  /**
   * Номера своих действующих поездок, где ждут этого человека.
   *
   * Складывается с поездками, у которых есть проблема: одна и та же поездка в
   * числе у раздела должна считаться один раз.
   */
  mineWaiting: number[];
  /**
   * Свои действующие поездки, где человек автор.
   *
   * Все, а не только те, где его ждут по роли: проблема автора не зависит от
   * роли. Поездку без готовых документов у сотрудника без ролей никто не
   * «ждёт», но ехать по ней он не сможет, и знать об этом должен он.
   */
  mine: AttentionTrip[];
  /** Следующая бронь машины, которая не вернулась: по машине. */
  nextBookings: Map<string, { label: string; startsAt: string }>;
  /**
   * Машины, которые сейчас не вернулись из поездки.
   *
   * Пусто у рецепции и АХО: им то же самое сказано строкой просрочки, где
   * названы и машина, и чей выезд она ломает.
   */
  stuckCars: Set<string>;
  /**
   * Поездки, которые человек видит в своём списке: свои и те, где он участник.
   *
   * По ним проблема показывается рамкой в строке, а не блоком наверху.
   * Остальные — чужие: их в списке нет, и сказать о них можно только блоком.
   */
  ownTripIds: Set<number>;
}

const EMPTY_SECTION: SectionCount = { total: 0, urgent: 0 };
const EMPTY_RECEPTION: ReceptionCount = { total: 0, urgent: 0, toIssue: 0, toAccept: 0, stale: 0 };

/** Сколько строк проблем показываем. */
const URGENT_SHOWN = 3;

/**
 * Сколько минут после выезда «пора выдать ключи» остаётся срочным.
 *
 * Опоздали на час — это ещё работа на сегодня. Не пришли вовсе — это разбор, и
 * такие заявки живут в списке «Не выехали», а не в красных строках: иначе они
 * висели бы там неделями.
 */
const LATE_PICKUP_MINUTES = 120;

/**
 * Насколько близка беда. Чем меньше, тем выше строка.
 *
 * 1 — уже случилось: машина не вернулась. 2 — машина у стойки и ждёт. 3 — до
 * выезда минуты. 4 — некому ехать. 5 — не с чем ехать.
 */
export type Rank = 1 | 2 | 3 | 4 | 5;

interface Ranked {
  rank: Rank;
  row: UrgentRow;
}

function minutesLeft(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / 60_000;
}

/** Выезд вот-вот: минуты вперёд или небольшое опоздание. */
function isSoon(iso: string, now: Date): boolean {
  const left = minutesLeft(iso, now);
  return left <= URGENT_SOON_MINUTES && left > -LATE_PICKUP_MINUTES;
}

/**
 * Выезд близко: в пределах суток и **ещё впереди**.
 *
 * Нижняя граница обязательна. Очередь документов включает поездки в пути — их
 * могли изменить после выдачи ключей, — и без неё «документы не готовы»
 * краснело бы у поездки, которая уехала неделю назад.
 */
function isNear(iso: string, now: Date): boolean {
  const left = minutesLeft(iso, now);
  return left > 0 && left <= URGENT_TRIP_HOURS * 60;
}

function waitedSince(trip: AttentionTrip): string {
  return `ждали ${formatMoment(new Date(trip.endsAt))}`;
}

function departureAt(trip: AttentionTrip): string {
  return `выезд ${formatMoment(new Date(trip.startsAt))}`;
}

/** Дела рецепции. Проблема — то, что стоит у стойки или вот-вот поедет. */
function receptionWork(
  day: ReceptionInput,
  now: Date,
  nextBookings: AttentionInput['nextBookings'],
): { count: ReceptionCount; rows: Ranked[] } {
  const rows: Ranked[] = [];

  for (const trip of day.overdue) {
    const blocked = trip.carId ? nextBookings.get(trip.carId) : undefined;

    rows.push({
      rank: 1,
      row: {
        tripId: trip.id,
        label: trip.label,
        what: blocked
          ? `машина не вернулась, а на неё ждут: ${blocked.label} в ${formatTime(new Date(blocked.startsAt))}`
          : trip.odometerEndKm === null
            ? 'машина не вернулась'
            : 'возврат просрочен, ключи ждут приёма',
        when: waitedSince(trip),
        href: '/reception',
      },
    });
  }

  for (const trip of day.early) {
    rows.push({
      rank: 2,
      row: {
        tripId: trip.id,
        label: trip.label,
        what: 'привезли раньше срока — ключи можно принять',
        when: `плановый возврат ${formatMoment(new Date(trip.endsAt))}`,
        href: '/reception',
      },
    });
  }

  const returnsReady = day.returns.filter((trip) => trip.odometerEndKm !== null);

  for (const trip of returnsReady) {
    rows.push({
      rank: 2,
      row: {
        tripId: trip.id,
        label: trip.label,
        what: 'ключи можно принять',
        when: `возврат ${formatTime(new Date(trip.endsAt))}`,
        href: '/reception',
      },
    });
  }

  const ready = day.issues.filter((trip) => trip.docsReady);

  for (const trip of ready.filter((trip) => isSoon(trip.startsAt, now))) {
    rows.push({
      rank: 3,
      row: {
        tripId: trip.id,
        label: trip.label,
        what: 'пора выдать ключи',
        when: `выезд ${formatTime(new Date(trip.startsAt))}`,
        href: '/reception',
      },
    });
  }

  const toAccept = day.overdue.length + day.early.length + returnsReady.length;

  return {
    count: {
      total: ready.length + toAccept,
      urgent: rows.length,
      toIssue: ready.length,
      toAccept,
      stale: day.stale,
    },
    rows,
  };
}

/**
 * Очередь документов. Проблема — выезд близко, а комплекта нет.
 *
 * Это единственное, что прямо срывает поездку, и до сих пор об этом не знал
 * никто: планировщик документы не проверял, а автор узнавал на рецепции.
 */
function documentsWork(
  queue: AttentionTrip[],
  now: Date,
): { count: SectionCount; rows: Ranked[] } {
  const late = queue.filter((trip) => isNear(trip.startsAt, now));

  return {
    count: { total: queue.length, urgent: late.length },
    rows: late.map((trip) => ({
      rank: 5 as Rank,
      row: {
        tripId: trip.id,
        label: trip.label,
        what: trip.docsRecheck ? 'документы не проверены заново' : 'документы не готовы',
        when: departureAt(trip),
        href: '/documents',
      },
    })),
  };
}

/** Свои поездки: что из них проблема автора. */
function myWork(
  mine: AttentionTrip[],
  now: Date,
  stuckCars: Set<string>,
): Ranked[] {
  const rows: Ranked[] = [];

  for (const trip of mine) {
    const href = `/trips/${trip.id}`;
    const overdue = new Date(trip.endsAt).getTime() < now.getTime();

    if (trip.status === 'in_trip') {
      if (overdue && trip.odometerEndKm === null && !trip.needsDriver) {
        rows.push({
          rank: 1,
          row: {
            tripId: trip.id,
            label: trip.label,
            what: 'нужно показание одометра — срок возврата прошёл',
            when: waitedSince(trip),
            href,
          },
        });
      }
      continue;
    }

    if (trip.carId && stuckCars.has(trip.carId)) {
      rows.push({
        rank: 4,
        row: {
          tripId: trip.id,
          label: trip.label,
          what: 'машина под вопросом: не вернулась из предыдущей поездки',
          when: departureAt(trip),
          href,
        },
      });
      continue;
    }

    if (trip.needsDriver && trip.driverConfirmation === 'declined') {
      rows.push({
        rank: 4,
        row: {
          tripId: trip.id,
          label: trip.label,
          what: 'водитель отказался — решите: ехать самому или отменить',
          when: departureAt(trip),
          href,
        },
      });
      continue;
    }

    if (
      trip.needsDriver &&
      trip.driverConfirmation !== 'confirmed' &&
      trip.driverConfirmation !== 'not_required' &&
      isNear(trip.startsAt, now)
    ) {
      rows.push({
        rank: 4,
        row: {
          tripId: trip.id,
          label: trip.label,
          what: 'водитель не подтвердил поездку',
          when: departureAt(trip),
          href,
        },
      });
      continue;
    }

    if (!trip.docsReady && isNear(trip.startsAt, now)) {
      rows.push({
        rank: 5,
        row: {
          tripId: trip.id,
          label: trip.label,
          what: trip.docsRecheck
            ? 'документы на повторной проверке — без них ключи не выдадут'
            : 'документы ещё не готовы — без них ключи не выдадут',
          when: departureAt(trip),
          href,
        },
      });
      continue;
    }

    if (trip.docsReady && !trip.keysIssued && isSoon(trip.startsAt, now)) {
      rows.push({
        rank: 3,
        row: {
          tripId: trip.id,
          label: trip.label,
          what: 'пора забрать документы и ключи на рецепции',
          when: `выезд ${formatTime(new Date(trip.startsAt))}`,
          href,
        },
      });
    }
  }

  return rows;
}

export function attention(input: AttentionInput): NavCounts {
  const reception = input.reception
    ? receptionWork(input.reception, input.now, input.nextBookings)
    : { count: EMPTY_RECEPTION, rows: [] as Ranked[] };

  const documents = input.documents
    ? documentsWork(input.documents, input.now)
    : { count: EMPTY_SECTION, rows: [] as Ranked[] };

  const mineRows = myWork(input.mine, input.now, input.stuckCars);

  // Одна поездка может быть проблемой и для рецепции, и для автора. Строка
  // нужна одна — та, что выше по важности.
  const byTrip = new Map<number, Ranked>();

  for (const item of [...reception.rows, ...documents.rows, ...mineRows]) {
    const kept = byTrip.get(item.row.tripId);
    if (!kept || item.rank < kept.rank) {
      byTrip.set(item.row.tripId, item);
    }
  }

  const ranked = [...byTrip.values()].sort(
    (a, b) => a.rank - b.rank || a.row.tripId - b.row.tripId,
  );

  const own: OwnProblem[] = [];
  const foreign: UrgentRow[] = [];

  for (const item of ranked) {
    if (input.ownTripIds.has(item.row.tripId)) {
      own.push({ tripId: item.row.tripId, what: item.row.what, when: item.row.when });
    } else {
      foreign.push(item.row);
    }
  }

  // Поездка, где ждут человека, и поездка с проблемой — это может быть одна и
  // та же поездка. В числе у раздела она должна быть одна.
  const mineIds = new Set(input.mineWaiting);
  for (const item of mineRows) {
    mineIds.add(item.row.tripId);
  }
  // Чужая проблема своей поездки — например, её же ждут на рецепции — тоже
  // считается делом автора: он видит рамку в своей строке.
  for (const item of [...reception.rows, ...documents.rows]) {
    if (input.ownTripIds.has(item.row.tripId)) {
      mineIds.add(item.row.tripId);
    }
  }

  return {
    // Своя поездка с проблемой — тоже дело этого человека, даже если по роли
    // его никто не ждёт: в число у раздела она входит.
    mine: { total: mineIds.size, urgent: own.length },
    reception: reception.count,
    documents: documents.count,
    cars: { total: input.remarks, urgent: 0 },
    urgent: foreign.slice(0, URGENT_SHOWN),
    own,
  };
}
