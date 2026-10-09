begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'suplementacao_products'
                    and column_name = 'display_unit') then
    raise exception 'PARE: rode 14-unidades-e-saldo-negativo.sql antes do 15.';
  end if;
end $$;

alter table public.suplementacao_products
  add column if not exists display_unit_primary boolean not null default false;

drop view if exists public.suplementacao_product_stock;

create view public.suplementacao_product_stock as
select
  p.id as product_id,
  p.name,
  p.active,
  coalesce(sum(m.quantity_kg), 0) as quantity_kg,
  p.display_unit,
  p.display_unit_kg,
  p.display_unit_primary,
  coalesce(sum(m.quantity_kg), 0) < 0 as negative,
  max(m.occurred_at) as last_movement_at,
  coalesce(c.avg_unit_cost, 0) as avg_unit_cost
from public.suplementacao_products p
left join public.suplementacao_stock_movements m on m.product_id = p.id
left join public.suplementacao_product_cost c on c.product_id = p.id
group by p.id, c.avg_unit_cost;

grant select on public.suplementacao_product_stock to authenticated;

commit;
