alter table public.cars
  add column comment text,
  alter column odometer_km drop not null;

alter table public.drivers add column comment text;

create or replace view public.v_cars as
select c.id, c.plate, c.model, c.odometer_km, c.is_active, c.created_at, c.updated_at,
  exists (
    select 1 from public.car_repairs r where r.car_id = c.id and r.until is null
  ) as in_repair,
  c.comment
from public.cars c;

create or replace view public.v_drivers as
select d.id, d.full_name, d.phone, d.telegram_chat_id, d.telegram_linked_at,
  d.is_active, d.created_at, d.updated_at, d.telegram_username, d.telegram_display_name,
  d.telegram_chat_id is not null as telegram_linked,
  (
    select json_agg(json_build_object('since', u.since, 'until', u.until, 'reason', u.reason)
                    order by u.since)
    from public.driver_unavailability u
    where u.driver_id = d.id and u.until >= current_date
  ) as upcoming_unavailability,
  d.comment
from public.drivers d;

create function public.require_car_odometer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.car_id is not distinct from new.car_id then
      return new;
    end if;
  end if;

  if exists (
    select 1 from public.cars where id = new.car_id and odometer_km is null
  ) then
    raise exception 'car_odometer_required';
  end if;

  return new;
end;
$$;

create trigger trg_trips_require_car_odometer
before insert or update of car_id on public.trips
for each row execute function public.require_car_odometer();

revoke execute on function public.require_car_odometer() from public, anon, authenticated;
