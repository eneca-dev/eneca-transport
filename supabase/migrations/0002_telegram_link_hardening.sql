-- Укрепление привязки Telegram.
--
-- Бот публичный: его находят поиском, иначе водитель бы его не нашёл. Значит
-- вводить код может кто угодно, и без ограничения попыток четырёхзначный код
-- перебирается за минуты. Код удлиняется до шести знаков (в коде приложения),
-- а здесь появляется счётчик неудачных попыток на чат.

create table telegram_link_attempts (
  chat_id           bigint primary key,
  failed_count      integer not null default 0 check (failed_count >= 0),
  -- Начало текущего окна. Окно истекло — счётчик обнуляется.
  window_started_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table telegram_link_attempts is
  'Неудачные попытки ввода кода привязки, по чату Telegram. Защита от перебора.';

-- Кто подключился: имя и @username из Telegram. Нужны АХО, чтобы глазами
-- сверить, что код ввёл именно водитель, а не тот, кому он случайно попал.
alter table drivers add column telegram_username text;
alter table drivers add column telegram_display_name text;

comment on column drivers.telegram_username is
  'Как подключившийся представлен в Telegram. Для проверки в Э9, не для отправки.';

-- Представление пересоздаётся: в drivers появились столбцы, а v_drivers
-- выбирает d.* — без пересоздания новые поля в него не попадут.
drop view v_drivers;

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
