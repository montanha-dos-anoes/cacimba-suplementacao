begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is null then
    raise exception 'PARE: rode 13-unificar-estoque.sql antes do 16.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = '_suplementacao_feeding_movement') then
    raise exception 'PARE: a funcao _suplementacao_feeding_movement nao existe. Rode 13-unificar-estoque.sql (ou 10-feeding-stock.sql) antes do 16.';
  end if;
end $$;

drop trigger if exists feeding_records_stock on public.suplementacao_feeding_records;

create trigger feeding_records_stock
after insert or update on public.suplementacao_feeding_records
for each row execute function public._suplementacao_feeding_movement();

insert into public.suplementacao_stock_movements
  (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
select f.product_id, 'feeding', -f.quantity_kg, f.occurred_at, f.id, f.recorded_by
  from public.suplementacao_feeding_records f
 where f.product_id is not null
   and not exists (
     select 1 from public.suplementacao_stock_movements m where m.feeding_record_id = f.id
   );

commit;

select p.name as produto,
       round(sum(m.quantity_kg) filter (where m.kind = 'feeding'), 3) as total_tratado_kg,
       round(coalesce(sum(m.quantity_kg), 0), 3) as saldo_atual_kg
  from public.suplementacao_stock_movements m
  join public.suplementacao_products p on p.id = m.product_id
 group by p.name
 having sum(m.quantity_kg) filter (where m.kind = 'feeding') is not null
 order by p.name;
