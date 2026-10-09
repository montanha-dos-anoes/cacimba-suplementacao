begin;

create or replace function public._suplementacao_feeding_movement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null then
    delete from public.suplementacao_product_movements where feeding_record_id = new.id;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.suplementacao_product_movements
      (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
    values
      (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
  else
    update public.suplementacao_product_movements
       set product_id = new.product_id,
           quantity_kg = -new.quantity_kg,
           occurred_at = new.occurred_at
     where feeding_record_id = new.id;

    if not found then
      insert into public.suplementacao_product_movements
        (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
      values
        (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists feeding_records_stock on public.suplementacao_feeding_records;
create trigger feeding_records_stock
after insert or update on public.suplementacao_feeding_records
for each row execute function public._suplementacao_feeding_movement();

insert into public.suplementacao_product_movements
  (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
select f.product_id, 'feeding', -f.quantity_kg, f.occurred_at, f.id, f.recorded_by
  from public.suplementacao_feeding_records f
 where f.product_id is not null
   and not exists (
     select 1 from public.suplementacao_product_movements m where m.feeding_record_id = f.id
   );

commit;
