begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is null
     or to_regclass('public.suplementacao_productions') is null then
    raise exception 'PARE: rode os scripts de estoque e fabricacao antes desta correcao.';
  end if;
  if to_regclass('public.suplementacao_product_cost') is null then
    raise exception 'PARE: a view suplementacao_product_cost nao existe.';
  end if;
end $$;

create or replace function public._suplementacao_sync_production_yield_cost()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_unit_cost numeric;
begin
  if new.quantity_kg is null or new.quantity_kg <= 0 then
    return new;
  end if;

  v_unit_cost := round(coalesce(new.total_cost, 0) / new.quantity_kg, 4);

  update public.suplementacao_stock_movements
     set unit_cost = v_unit_cost
   where production_id = new.id
     and product_id = new.product_id
     and kind = 'yield'
     and unit_cost is distinct from v_unit_cost;

  return new;
end;
$$;

drop trigger if exists production_sync_yield_cost on public.suplementacao_productions;
create trigger production_sync_yield_cost
after update of total_cost, quantity_kg, product_id on public.suplementacao_productions
for each row execute function public._suplementacao_sync_production_yield_cost();

update public.suplementacao_stock_movements m
   set unit_cost = round(coalesce(p.total_cost, 0) / p.quantity_kg, 4)
  from public.suplementacao_productions p
 where m.production_id = p.id
   and m.product_id = p.product_id
   and m.kind = 'yield'
   and p.quantity_kg > 0
   and m.unit_cost is distinct from round(coalesce(p.total_cost, 0) / p.quantity_kg, 4);

create or replace view public.suplementacao_product_cost as
select
  p.id as product_id,
  case
    when coalesce(sum(m.quantity_kg) filter (where m.kind in ('entry', 'yield')), 0) > 0
    then sum(m.quantity_kg * m.unit_cost) filter (where m.kind in ('entry', 'yield'))
       / sum(m.quantity_kg) filter (where m.kind in ('entry', 'yield'))
    else 0
  end as avg_unit_cost
from public.suplementacao_products p
left join public.suplementacao_stock_movements m on m.product_id = p.id
group by p.id;

grant select on public.suplementacao_product_cost to authenticated;

commit;
