begin;

alter table public.suplementacao_ingredients
  add column if not exists alt_unit text,
  add column if not exists alt_unit_kg numeric(14,4);

alter table public.suplementacao_ingredients
  drop constraint if exists suplementacao_ingredients_alt_unit_check,
  drop constraint if exists suplementacao_ingredients_alt_unit_kg_scope;

alter table public.suplementacao_ingredients
  add constraint suplementacao_ingredients_alt_unit_check
    check (alt_unit is null or (alt_unit <> unit and alt_unit_kg is not null and alt_unit_kg > 0)),
  add constraint suplementacao_ingredients_alt_unit_kg_scope
    check (alt_unit is null or unit = 'kg');

create or replace view public.suplementacao_ingredient_stock as
select
  i.id as ingredient_id,
  i.name,
  i.unit,
  i.min_stock,
  i.active,
  coalesce(sum(m.quantity), 0) as quantity,
  coalesce(sum(m.quantity), 0) < i.min_stock as below_min,
  coalesce(c.avg_unit_cost, 0) as avg_unit_cost,
  i.alt_unit,
  i.alt_unit_kg
from public.suplementacao_ingredients i
left join public.suplementacao_ingredient_movements m on m.ingredient_id = i.id
left join public.suplementacao_ingredient_cost c on c.ingredient_id = i.id
group by i.id, c.avg_unit_cost;

commit;
