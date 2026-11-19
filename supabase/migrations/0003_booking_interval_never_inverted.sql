-- Занятый интервал не может кончаться раньше, чем начинается.
--
-- Найдено 19.11 при проверке возврата. Если ключи выданы заранее, а возврат
-- оформлен до планового выезда (взял ключи в 06:50, машина не завелась, сдал
-- в 06:55 при выезде в 07:00), триггер строил tstzrange(07:00, 06:55 + 10 мин)
-- — и Postgres отказывал: «range lower bound must be less than or equal to
-- range upper bound», код 22000.
--
-- Последствие было хуже самой ошибки: рецепция не могла принять ключи, поездка
-- оставалась в пути, а машина — занятой.
--
-- Решение: правая граница не опускается ниже выезда. Фактический возврат
-- раньше выезда означает, что машина занята только буфер от планового времени.

create or replace function fn_trips_booking_during() returns trigger
  language plpgsql as $$
begin
  if new.status in ('draft', 'cancelled') then
    -- Черновик не бронирует, отмена освобождает машину и водителя.
    new.booking_during := null;
  elsif new.status = 'closed' then
    -- Досрочный возврат освобождает остаток брони; просрочка — продлевает.
    -- Буфер считается от фактического возврата, но не раньше выезда.
    new.booking_during := tstzrange(
      new.starts_at,
      greatest(coalesce(new.keys_returned_at, new.ends_at), new.starts_at)
        + fn_booking_buffer(),
      '[)'
    );
  else
    new.booking_during := tstzrange(new.starts_at, new.ends_at + fn_booking_buffer(), '[)');
  end if;
  new.updated_at := now();
  return new;
end $$;
