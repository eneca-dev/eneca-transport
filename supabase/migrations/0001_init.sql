-- ЭНЭКА.Командировки. Этап 1. Базовая схема.
-- Все метки времени — timestamptz, отображение в Europe/Minsk на стороне приложения.

create extension if not exists btree_gist;

-- ============================================================
-- Сотрудники и роли
-- ============================================================

-- Справочник сотрудников, синхронизируется из Microsoft Graph.
-- Источник истины — Entra ID; локальная копия нужна для поля «Участники»,
-- отдела и руководителя без обращения к Graph на каждый запрос.
create table employees (
  id                uuid primary key default gen_random_uuid(),
  entra_oid         uuid not null unique,
  upn               text not null,
  display_name      text not null,
  department        text,
  job_title         text,
  manager_entra_oid uuid,
  is_active         boolean not null default true,
  synced_at         timestamptz not null default now()
);

create index employees_display_name_idx on employees using gin (to_tsvector('simple', display_name));
create index employees_active_idx on employees (is_active) where is_active;

-- Роли приложения. Назначает АХО в интерфейсе (Э9 / настройки),
-- не через App Roles в Entra — иначе каждое назначение требует заявки в ИТ.
create type app_role as enum ('aho', 'reception', 'finance');

create table employee_roles (
  employee_id uuid not null references employees (id) on delete cascade,
  role        app_role not null,
  granted_by  uuid references employees (id),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, role)
);

-- ============================================================
-- Машины
-- ============================================================

create table cars (
  id           uuid primary key default gen_random_uuid(),
  plate        text not null unique,
  model        text not null,
  -- Текущее показание: значение последнего возврата. Начальное для следующей поездки.
  odometer_km  integer not null check (odometer_km >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Периоды ремонта. Открытый период (until is null) = машина в ремонте сейчас.
-- Отдельная таблица, а не поле status, чтобы ремонт был виден в календаре Э6.
create table car_repairs (
  id         uuid primary key default gen_random_uuid(),
  car_id     uuid not null references cars (id) on delete cascade,
  since      date not null,
  until      date,
  note       text,
  created_by uuid references employees (id),
  created_at timestamptz not null default now(),
  check (until is null or until >= since)
);

create index car_repairs_car_idx on car_repairs (car_id);
create unique index car_repairs_one_open_per_car on car_repairs (car_id) where until is null;

-- ============================================================
-- Водители
-- ============================================================

create table drivers (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  phone              text,
  telegram_chat_id   bigint unique,
  telegram_linked_at timestamptz,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Одноразовый код привязки Telegram. Выдаёт АХО в Э9, действует 24 часа.
create table driver_link_codes (
  code       text primary key,
  driver_id  uuid not null references drivers (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_by uuid references employees (id),
  created_at timestamptz not null default now()
);

create index driver_link_codes_driver_idx on driver_link_codes (driver_id);

-- Недоступность водителя (болезнь, отпуск). Вносит только АХО — водитель
-- сообщает о болезни Дарье, в Telegram-боте сам не отмечает.
create type unavailability_reason as enum ('sick', 'vacation', 'other');

create table driver_unavailability (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references drivers (id) on delete cascade,
  since      date not null,
  until      date not null,
  reason     unavailability_reason not null,
  note       text,
  created_by uuid references employees (id),
  created_at timestamptz not null default now(),
  check (until >= since),
  -- Пересекающиеся периоды недоступности одного водителя бессмысленны.
  exclude using gist (
    driver_id with =,
    daterange(since, until, '[]') with &&
  )
);

-- ============================================================
-- Поездки
-- ============================================================

create type trip_status as enum ('draft', 'booked', 'docs_ready', 'in_trip', 'closed', 'cancelled');

-- not_required — поездка без водителя; timeout — не подтвердил за 15 минут.
create type driver_confirmation as enum ('not_required', 'pending', 'confirmed', 'declined', 'timeout');

create table trips (
  id                    bigint generated always as identity primary key, -- номер заявки (#127)
  status                trip_status not null default 'draft',
  author_id             uuid not null references employees (id),

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  route                 text not null,
  contract              text not null,
  purpose               text not null,

  needs_driver          boolean not null,
  car_id                uuid references cars (id),
  driver_id             uuid references drivers (id),
  driver_confirmation   driver_confirmation not null default 'not_required',
  -- Момент отправки Т1. От него отсчитываются 15 минут на подтверждение.
  driver_assigned_at    timestamptz,

  -- Занятый интервал: машина и водитель заняты с «Забронирована» до «Закрыта».
  -- Поддерживается триггером trg_trips_booking_during, см. ниже.
  booking_during        tstzrange,

  docs_ready_at         timestamptz,
  docs_ready_by         uuid references employees (id),
  -- Заявку изменили после подготовки документов — финотдел проверяет повторно.
  docs_recheck_required boolean not null default false,

  keys_issued_at        timestamptz,
  keys_issued_by        uuid references employees (id),
  keys_returned_at      timestamptz,
  keys_returned_by      uuid references employees (id),

  -- Снимок cars.odometer_km на момент выдачи ключей: начальное показание.
  odometer_start_km     integer,
  odometer_end_km       integer,
  distance_km           integer generated always as (odometer_end_km - odometer_start_km) stored,
  condition_ok          boolean,
  return_note           text,

  closed_at             timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid references employees (id),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (ends_at > starts_at),
  check (odometer_end_km is null or odometer_start_km is null or odometer_end_km >= odometer_start_km),
  -- Поездка с водителем не может быть забронирована без водителя.
  check (not needs_driver or status in ('draft', 'cancelled') or driver_id is not null)
);

create index trips_status_idx on trips (status);
create index trips_author_idx on trips (author_id);
create index trips_car_idx on trips (car_id);
create index trips_driver_idx on trips (driver_id);
create index trips_starts_at_idx on trips (starts_at);
-- Ожидающие подтверждения водителя: планировщик опрашивает раз в минуту.
create index trips_awaiting_confirmation_idx on trips (driver_assigned_at)
  where driver_confirmation = 'pending';

create table trip_participants (
  trip_id     bigint not null references trips (id) on delete cascade,
  employee_id uuid not null references employees (id),
  primary key (trip_id, employee_id)
);

create index trip_participants_employee_idx on trip_participants (employee_id);

-- ============================================================
-- Бронь без пересечений — на уровне БД, а не интерфейса
-- ============================================================

-- Буфер на подготовку автомобиля между поездками.
create function fn_booking_buffer() returns interval
  language sql immutable as $$ select interval '10 minutes' $$;

-- booking_during хранится отдельной колонкой, а не вычисляется в constraint:
-- выражение timestamptz + interval не immutable и в индекс не годится.
create function fn_trips_booking_during() returns trigger
  language plpgsql as $$
begin
  if new.status in ('draft', 'cancelled') then
    -- Черновик не бронирует, отмена освобождает машину и водителя.
    new.booking_during := null;
  elsif new.status = 'closed' then
    -- Досрочный возврат освобождает остаток брони; просрочка — продлевает.
    -- Буфер считается от фактического возврата.
    new.booking_during := tstzrange(
      new.starts_at,
      coalesce(new.keys_returned_at, new.ends_at) + fn_booking_buffer(),
      '[)'
    );
  else
    new.booking_during := tstzrange(new.starts_at, new.ends_at + fn_booking_buffer(), '[)');
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger trg_trips_booking_during
  before insert or update on trips
  for each row execute function fn_trips_booking_during();

-- Пересечение по машине невозможно. Строки с booking_during is null
-- (черновик, отмена) и car_id is null в проверке не участвуют.
alter table trips add constraint trips_car_no_overlap
  exclude using gist (car_id with =, booking_during with &&);

-- Пересечение по водителю невозможно.
alter table trips add constraint trips_driver_no_overlap
  exclude using gist (driver_id with =, booking_during with &&);

-- ============================================================
-- Одометр: история значений и исправлений
-- ============================================================

create type odometer_entry_kind as enum ('return', 'correction');

create table odometer_readings (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            bigint not null references trips (id) on delete cascade,
  car_id             uuid not null references cars (id),
  kind               odometer_entry_kind not null,
  value_km           integer not null check (value_km >= 0),
  -- Для correction: что было до исправления и обязательная причина.
  previous_value_km  integer,
  reason             text,
  entered_by_employee uuid references employees (id),
  entered_by_driver   uuid references drivers (id),
  created_at         timestamptz not null default now(),
  check (kind <> 'correction' or (previous_value_km is not null and reason is not null)),
  -- Кто ввёл: сотрудник в Teams или водитель в Telegram, но не оба.
  check (num_nonnulls(entered_by_employee, entered_by_driver) = 1)
);

create index odometer_readings_trip_idx on odometer_readings (trip_id);
create index odometer_readings_car_idx on odometer_readings (car_id, created_at desc);

-- ============================================================
-- Журнал поездки (Э3)
-- ============================================================

create table trip_events (
  id              bigint generated always as identity primary key,
  trip_id         bigint not null references trips (id) on delete cascade,
  kind            text not null,
  payload         jsonb not null default '{}'::jsonb,
  actor_employee  uuid references employees (id),
  actor_driver    uuid references drivers (id),
  created_at      timestamptz not null default now()
);

create index trip_events_trip_idx on trip_events (trip_id, created_at);

-- ============================================================
-- Исходящие сообщения: карточки Teams (К1–К16) и Telegram (Т1–Т6)
-- ============================================================

create type notification_channel as enum ('teams', 'telegram');

-- Очередь сообщений. Планировщик на VPS опрашивает её раз в минуту:
-- и немедленные отправки, и отложенные (17:00 накануне, повтор через 2 часа).
create table notifications (
  id                  bigint generated always as identity primary key,
  template            text not null, -- 'K1'..'K16', 'T1'..'T6'
  channel             notification_channel not null,
  trip_id             bigint references trips (id) on delete cascade,
  recipient_employee  uuid references employees (id),
  recipient_driver    uuid references drivers (id),
  payload             jsonb not null default '{}'::jsonb,
  send_after          timestamptz not null default now(),
  sent_at             timestamptz,
  failed_at           timestamptz,
  attempts            integer not null default 0,
  last_error          text,
  -- Идентификатор отправленного сообщения: нужен, чтобы обновлять карточку
  -- после нажатия кнопки («✅ Ключи выданы 05.11 06:52»).
  external_message_id text,
  -- Идемпотентность планировщика: 'K5:trip:127' отправится один раз.
  dedupe_key          text unique,
  created_at          timestamptz not null default now(),
  check (num_nonnulls(recipient_employee, recipient_driver) = 1)
);

create index notifications_pending_idx on notifications (send_after)
  where sent_at is null and failed_at is null;

-- Адрес личного чата сотрудника с ботом в Teams. Без него бот не может
-- написать первым, поэтому сохраняется при первой установке приложения.
create table teams_conversations (
  employee_id     uuid primary key references employees (id) on delete cascade,
  conversation_id text not null,
  service_url     text not null,
  tenant_id       text not null,
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- Представления
-- ============================================================

create view v_cars as
select
  c.*,
  exists (select 1 from car_repairs r where r.car_id = c.id and r.until is null) as in_repair
from cars c;

create view v_drivers as
select
  d.*,
  d.telegram_chat_id is not null as telegram_linked,
  (
    select json_agg(json_build_object('since', u.since, 'until', u.until, 'reason', u.reason)
                    order by u.since)
    from driver_unavailability u
    where u.driver_id = d.id and u.until >= current_date
  ) as upcoming_unavailability
from drivers d;
