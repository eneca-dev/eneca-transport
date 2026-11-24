import 'server-only';

import { getDb } from '@/config/supabase';
import { minskDayBounds, toMinskDate } from '@/modules/trips/booking';

/**
 * Экран рецепции (Э4): что выдать и что принять.
 *
 * Четыре списка, как в требованиях: просроченные, досрочный возврат, выдача,
 * возврат. Сутки — минские, а не по UTC.
 *
 * Два режима. Сегодня — рабочий: просроченные показываются все, включая
 * прошлые дни (ключи, не сданные позавчера, не должны исчезнуть с экрана), и
 * только здесь работают кнопки. Другой день — план: что выезжает и что
 * возвращается, без кнопок. Выдавать и принимать ключи можно только сейчас:
 * машина стоит у рецепции в настоящем времени, а не во вторник.
 */

export interface ReceptionTrip {
  id: number;
  status: string;
  startsAt: string;
  endsAt: string;
  route: string;
  authorName: string;
  carLabel: string | null;
  driverName: string | null;
  needsDriver: boolean;
  /** Документы готовы и не требуют повторной проверки. */
  docsReady: boolean;
  docsRecheckRequired: boolean;
  keysIssuedAt: string | null;
  odometerStartKm: number | null;
  odometerEndKm: number | null;
}

export interface ReceptionDay {
  /** Показанный день, «2026-11-24» по минскому календарю. */
  day: string;
  /** Показано сегодня: только тогда есть просроченные и досрочные и работают кнопки. */
  isToday: boolean;
  /** Выдачи: заявки, которым пора ехать, а ключи ещё не выданы. */
  issues: ReceptionTrip[];
  /** Возвраты, плановое время которых приходится на показанный день. */
  returns: ReceptionTrip[];
  /**
   * Машину привезли раньше планового дня и показание одометра передали.
   * Ключи можно принять сейчас — ждать планового времени не требуется.
   */
  early: ReceptionTrip[];
  /** Поездки, у которых плановое время возврата прошло, а ключи не сданы. */
  overdue: ReceptionTrip[];
}

interface Row {
  id: number;
  status: string;
  starts_at: string;
  ends_at: string;
  route: string;
  needs_driver: boolean;
  docs_ready_at: string | null;
  docs_recheck_required: boolean;
  keys_issued_at: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  car_id: string | null;
  driver_id: string | null;
  cars: { plate: string; model: string } | null;
  drivers: { full_name: string } | null;
  employees: { display_name: string } | null;
}

const SELECT =
  'id, status, starts_at, ends_at, route, needs_driver, docs_ready_at, docs_recheck_required, ' +
  'keys_issued_at, odometer_start_km, odometer_end_km, car_id, driver_id, ' +
  'cars(plate, model), drivers(full_name), employees!trips_author_id_fkey(display_name)';

/** Заявки, которых на экране нет вовсе: черновик никто не заводил, отмена не едет. */
const VISIBLE_STATUSES = ['booked', 'docs_ready', 'in_trip', 'closed'];

function toTrip(row: Row): ReceptionTrip {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    route: row.route,
    authorName: row.employees?.display_name ?? '—',
    carLabel: row.cars ? `${row.cars.model} ${row.cars.plate}` : null,
    driverName: row.drivers?.full_name ?? null,
    needsDriver: row.needs_driver,
    docsReady: row.docs_ready_at !== null && !row.docs_recheck_required,
    docsRecheckRequired: row.docs_recheck_required,
    keysIssuedAt: row.keys_issued_at,
    odometerStartKm: row.odometer_start_km,
    odometerEndKm: row.odometer_end_km,
  };
}

/** Границы показанного дня. Полдень, чтобы разбор даты не уехал через сутки. */
function dayBounds(day: string): { from: Date; to: Date } {
  return minskDayBounds(new Date(`${day}T12:00:00+03:00`));
}

/** План на другой день: кто выезжает и кто возвращается, без кнопок. */
async function listPlannedDay(day: string): Promise<ReceptionDay> {
  const db = getDb();
  const { from, to } = dayBounds(day);

  const [issues, returns] = await Promise.all([
    db
      .from('trips')
      .select(SELECT)
      .in('status', VISIBLE_STATUSES)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .order('starts_at')
      .returns<Row[]>(),
    db
      .from('trips')
      .select(SELECT)
      .in('status', VISIBLE_STATUSES)
      .gte('ends_at', from.toISOString())
      .lt('ends_at', to.toISOString())
      .order('ends_at')
      .returns<Row[]>(),
  ]);

  if (issues.error) {
    throw new Error(`Не удалось прочитать выдачи: ${issues.error.message}`);
  }
  if (returns.error) {
    throw new Error(`Не удалось прочитать возвраты: ${returns.error.message}`);
  }

  return {
    day,
    isToday: false,
    issues: (issues.data ?? []).map(toTrip),
    returns: (returns.data ?? []).map(toTrip),
    early: [],
    overdue: [],
  };
}

/**
 * Что на экране рецепции.
 *
 * `day` не задан — сегодня. Заданный день, совпавший с сегодняшним, тоже даёт
 * рабочий режим: иначе кнопки исчезали бы от нажатия на «Сегодня».
 */
export async function listReceptionDay(day?: string, now = new Date()): Promise<ReceptionDay> {
  const today = toMinskDate(now);

  if (day && day !== today) {
    return listPlannedDay(day);
  }

  const db = getDb();
  const { to } = minskDayBounds(now);
  const nowIso = now.toISOString();
  const endOfDay = to.toISOString();

  // Выдачи: всё, чей выезд уже наступил или наступит сегодня, но ключи не
  // выданы. Прошедшие не убираем — иначе забытая выдача исчезнет с экрана.
  const issues = await db
    .from('trips')
    .select(SELECT)
    .in('status', ['booked', 'docs_ready'])
    .lt('starts_at', endOfDay)
    .order('starts_at')
    .returns<Row[]>();

  if (issues.error) {
    throw new Error(`Не удалось прочитать выдачи: ${issues.error.message}`);
  }

  const inTrip = await db
    .from('trips')
    .select(SELECT)
    .eq('status', 'in_trip')
    .order('ends_at')
    .returns<Row[]>();

  if (inTrip.error) {
    throw new Error(`Не удалось прочитать поездки в пути: ${inTrip.error.message}`);
  }

  const returns: ReceptionTrip[] = [];
  const early: ReceptionTrip[] = [];
  const overdue: ReceptionTrip[] = [];

  for (const row of inTrip.data ?? []) {
    const trip = toTrip(row);

    // Просрочка важнее принадлежности к сегодняшнему дню: поездка, которую
    // должны были вернуть утром, нужна рецепции в списке просроченных.
    if (row.ends_at < nowIso) {
      overdue.push(trip);
    } else if (row.ends_at < endOfDay) {
      returns.push(trip);
    } else if (row.odometer_end_km !== null) {
      // Плановый возврат ещё не наступил, а машину уже привезли и показание
      // передали. Без этого списка такую поездку рецепция не видит вовсе и не
      // может принять ключи до планового дня — а требования говорят обратное:
      // «ждать планового времени не требуется».
      early.push(trip);
    }
  }

  return { day: today, isToday: true, issues: (issues.data ?? []).map(toTrip), returns, early, overdue };
}
