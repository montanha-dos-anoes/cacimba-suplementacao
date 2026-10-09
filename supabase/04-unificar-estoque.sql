begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is not null then
    raise exception 'PARE: o script 13 ja foi aplicado neste banco (suplementacao_stock_movements existe). Siga a partir do 14.';
  end if;
  if to_regclass('public.suplementacao_ingredients') is null
     or to_regclass('public.suplementacao_product_movements') is null then
    raise exception 'PARE: falta a base deste banco. Rode 04-schema-insumos-formulas-producao.sql e 05-rls-insumos-formulas-producao.sql antes do 13.';
  end if;
  if to_regclass('public.suplementacao_products') is null then
    raise exception 'PARE: as tabelas legadas ainda nao foram renomeadas. Rode 02-rename-legadas-suplementacao.sql antes do 13.';
  end if;
end $$;

alter table public.suplementacao_ingredients
  add column if not exists alt_unit text,
  add column if not exists alt_unit_kg numeric(14,4);

alter table public.suplementacao_products
  add column if not exists unit text not null default 'kg',
  add column if not exists min_stock numeric(14,3) not null default 0,
  add column if not exists alt_unit text,
  add column if not exists alt_unit_kg numeric(14,4);

alter table public.suplementacao_products
  add constraint suplementacao_products_unit_check check (unit in ('kg','l','sc'));
alter table public.suplementacao_products
  add constraint suplementacao_products_min_stock_check check (min_stock >= 0);
alter table public.suplementacao_products
  add constraint suplementacao_products_alt_unit_check
    check (alt_unit is null or (alt_unit <> unit and alt_unit_kg is not null and alt_unit_kg > 0));
alter table public.suplementacao_products
  add constraint suplementacao_products_alt_unit_kg_scope
    check (alt_unit is null or unit = 'kg');

do $$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select n from (
      select lower(trim(name)) as n from public.suplementacao_products where active
      union all
      select lower(trim(name)) as n from public.suplementacao_ingredients where active
    ) u
    group by n having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Existem % nome(s) duplicado(s) entre produtos e/ou insumos ativos (contando colisao entre as duas tabelas antes da fusao). Resolva manualmente antes de migrar.', v_dupes;
  end if;
end $$;

alter table public.suplementacao_products
  drop constraint if exists products_name_key;

insert into public.suplementacao_products (id, name, unit, min_stock, alt_unit, alt_unit_kg, active, created_by, created_at)
select id, name, unit, min_stock, alt_unit, alt_unit_kg, active, created_by, created_at
from public.suplementacao_ingredients
on conflict (id) do nothing;

create unique index if not exists suplementacao_products_name_unique
  on public.suplementacao_products (lower(trim(name))) where active;

alter table public.suplementacao_product_movements rename to suplementacao_stock_movements;

alter table public.suplementacao_stock_movements
  rename constraint suplementacao_product_movements_pkey to suplementacao_stock_movements_pkey;
alter table public.suplementacao_stock_movements
  rename constraint suplementacao_product_movements_product_id_fkey to suplementacao_stock_movements_product_id_fkey;
alter table public.suplementacao_stock_movements
  rename constraint suplementacao_product_movements_production_id_fkey to suplementacao_stock_movements_production_id_fkey;
alter table public.suplementacao_stock_movements
  rename constraint suplementacao_product_movements_feeding_record_id_fkey to suplementacao_stock_movements_feeding_record_id_fkey;
alter table public.suplementacao_stock_movements
  rename constraint suplementacao_product_movements_recorded_by_fkey to suplementacao_stock_movements_recorded_by_fkey;

alter table public.suplementacao_stock_movements
  add column unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  add column supplier text,
  add column notes text;

create index if not exists suplementacao_stock_movements_product_idx
  on public.suplementacao_stock_movements (product_id, occurred_at desc);

alter table public.suplementacao_stock_movements
  drop constraint if exists suplementacao_product_movements_kind_check;

update public.suplementacao_stock_movements set kind = 'yield' where kind = 'production';

insert into public.suplementacao_stock_movements
  (id, product_id, kind, quantity_kg, unit_cost, occurred_at, supplier, reason, production_id, notes, recorded_by, created_at)
select
  id,
  ingredient_id,
  case kind
    when 'entry' then 'entry'
    when 'production' then 'consumption'
    when 'reversal' then 'reversal'
    when 'adjustment' then 'adjustment'
  end,
  quantity,
  unit_cost,
  occurred_at,
  supplier,
  reason,
  production_id,
  notes,
  recorded_by,
  created_at
from public.suplementacao_ingredient_movements;

alter table public.suplementacao_formula_items rename column ingredient_id to item_id;
alter table public.suplementacao_formula_items
  drop constraint if exists suplementacao_formula_items_ingredient_id_fkey;
alter table public.suplementacao_formula_items
  add constraint suplementacao_formula_items_item_id_fkey
    foreign key (item_id) references public.suplementacao_products(id);

alter table public.suplementacao_production_items rename column ingredient_id to item_id;
alter table public.suplementacao_production_items
  drop constraint if exists suplementacao_production_items_ingredient_id_fkey;
alter table public.suplementacao_production_items
  add constraint suplementacao_production_items_item_id_fkey
    foreign key (item_id) references public.suplementacao_products(id);

create or replace function public._suplementacao_formula_no_self_input()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
begin
  select product_id into v_product_id from public.suplementacao_formulas where id = new.formula_id;
  if v_product_id = new.item_id then
    raise exception 'O produto de saida da formula nao pode ser um item de entrada da mesma formula.';
  end if;
  return new;
end;
$$;

drop trigger if exists formula_items_no_self_input on public.suplementacao_formula_items;
create trigger formula_items_no_self_input
before insert or update on public.suplementacao_formula_items
for each row execute function public._suplementacao_formula_no_self_input();

drop view if exists public.suplementacao_ingredient_stock;
drop view if exists public.suplementacao_ingredient_cost;

drop function if exists public.suplementacao_add_ingredient_entry(uuid, numeric, numeric, timestamptz, text, text);
drop function if exists public.suplementacao_adjust_ingredient(uuid, numeric, text);
drop function if exists public.suplementacao_adjust_product(uuid, numeric, text);

drop table if exists public.suplementacao_ingredient_movements;
drop table if exists public.suplementacao_ingredients;

create or replace view public.suplementacao_product_cost as
select
  p.id as product_id,
  case
    when coalesce(sum(m.quantity_kg) filter (where m.kind in ('entry','yield')), 0) > 0
    then sum(m.quantity_kg * m.unit_cost) filter (where m.kind in ('entry','yield'))
       / sum(m.quantity_kg) filter (where m.kind in ('entry','yield'))
    else 0
  end as avg_unit_cost
from public.suplementacao_products p
left join public.suplementacao_stock_movements m on m.product_id = p.id
group by p.id;

create or replace view public.suplementacao_product_stock as
select
  p.id as product_id,
  p.name,
  p.active,
  coalesce(sum(m.quantity_kg), 0) as quantity_kg,
  p.unit,
  p.min_stock,
  p.alt_unit,
  p.alt_unit_kg,
  coalesce(sum(m.quantity_kg), 0) < p.min_stock as below_min,
  coalesce(c.avg_unit_cost, 0) as avg_unit_cost
from public.suplementacao_products p
left join public.suplementacao_stock_movements m on m.product_id = p.id
left join public.suplementacao_product_cost c on c.product_id = p.id
group by p.id, c.avg_unit_cost;

grant select on public.suplementacao_product_cost, public.suplementacao_product_stock to authenticated;

do $$
declare v_bad_reason int;
declare v_bad_direction int;
begin
  select count(*) into v_bad_reason
    from public.suplementacao_stock_movements
   where kind = 'adjustment' and nullif(trim(coalesce(reason, '')), '') is null;
  if v_bad_reason > 0 then
    raise exception 'Existem % movimento(s) de ajuste sem motivo preenchido (dado legado do lado produto, que nao exigia motivo antes desta migracao). Preencha manualmente antes de continuar.', v_bad_reason;
  end if;

  select count(*) into v_bad_direction
    from public.suplementacao_stock_movements
   where (kind = 'entry' and quantity_kg <= 0)
      or (kind = 'consumption' and quantity_kg >= 0)
      or (kind = 'yield' and quantity_kg <= 0)
      or (kind = 'feeding' and quantity_kg >= 0)
      or (kind = 'sale' and quantity_kg >= 0);
  if v_bad_direction > 0 then
    raise exception 'Existem % movimento(s) de estoque com sinal incompativel com o kind (dado legado inesperado). Verifique manualmente antes de continuar.', v_bad_direction;
  end if;
end $$;

alter table public.suplementacao_stock_movements
  add constraint suplementacao_stock_movements_kind_check
    check (kind in ('entry','consumption','yield','feeding','sale','reversal','adjustment'));
alter table public.suplementacao_stock_movements
  add constraint suplementacao_stock_movements_direction check (
    (kind = 'entry' and quantity_kg > 0)
    or (kind = 'consumption' and quantity_kg < 0)
    or (kind = 'yield' and quantity_kg > 0)
    or (kind = 'feeding' and quantity_kg < 0)
    or (kind = 'sale' and quantity_kg < 0)
    or kind in ('reversal', 'adjustment')
  );
alter table public.suplementacao_stock_movements
  add constraint suplementacao_stock_movements_reason check (
    kind <> 'adjustment' or nullif(trim(coalesce(reason, '')), '') is not null
  );

drop policy if exists suplementacao_product_movements_read on public.suplementacao_stock_movements;
drop policy if exists suplementacao_product_movements_write on public.suplementacao_stock_movements;

create policy suplementacao_stock_movements_read on public.suplementacao_stock_movements
  for select to authenticated using (public._suplementacao_role() is not null);

create policy suplementacao_stock_movements_write on public.suplementacao_stock_movements
  for all to authenticated
  using (public._suplementacao_role() in ('owner', 'admin'))
  with check (public._suplementacao_role() in ('owner', 'admin'));

create or replace function public.suplementacao_add_stock_entry(
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric default 0,
  p_occurred_at timestamptz default now(),
  p_supplier text default null,
  p_notes text default null
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para lançar entrada de estoque.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if not exists (select 1 from public.suplementacao_products where id = p_product_id and active) then
    raise exception 'Produto não encontrado ou inativo.';
  end if;

  insert into public.suplementacao_stock_movements
    (product_id, kind, quantity_kg, unit_cost, occurred_at, supplier, notes, recorded_by)
  values
    (p_product_id, 'entry', p_quantity, coalesce(p_unit_cost, 0), coalesce(p_occurred_at, now()),
     nullif(trim(coalesce(p_supplier, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), v_actor)
  returning * into v_movement;

  return v_movement;
end;
$$;

create or replace function public.suplementacao_adjust_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_balance numeric;
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para ajustar estoque.'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Informe uma quantidade diferente de zero.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do ajuste.'; end if;

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = p_product_id;

  if v_balance + p_quantity < 0 then
    raise exception 'O ajuste deixaria o saldo negativo. Saldo atual: % kg.', round(v_balance, 3);
  end if;

  insert into public.suplementacao_stock_movements
    (product_id, kind, quantity_kg, occurred_at, reason, recorded_by)
  values
    (p_product_id, 'adjustment', p_quantity, now(), trim(p_reason), v_actor)
  returning * into v_movement;

  return v_movement;
end;
$$;

create or replace function public.suplementacao_sell_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text default null
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_balance numeric;
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para registrar venda.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = p_product_id;

  if v_balance - p_quantity < 0 then
    raise exception 'A venda deixaria o saldo negativo. Saldo atual: % kg.', round(v_balance, 3);
  end if;

  insert into public.suplementacao_stock_movements
    (product_id, kind, quantity_kg, occurred_at, reason, recorded_by)
  values
    (p_product_id, 'sale', -p_quantity, now(), nullif(trim(coalesce(p_reason, '')), ''), v_actor)
  returning * into v_movement;

  return v_movement;
end;
$$;

create or replace function public.suplementacao_register_production(
  p_formula_id uuid,
  p_quantity_kg numeric,
  p_occurred_at timestamptz default now(),
  p_notes text default null
) returns public.suplementacao_productions
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_formula public.suplementacao_formulas;
  v_production public.suplementacao_productions;
  v_resolved numeric;
  v_factor numeric;
  v_total_cost numeric := 0;
  v_balance numeric;
  v_cost numeric;
  v_item record;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para registrar fabricação.'; end if;
  if p_quantity_kg is null or p_quantity_kg <= 0 then raise exception 'Informe a quantidade a produzir.'; end if;

  select * into v_formula from public.suplementacao_formulas where id = p_formula_id and active;
  if v_formula.id is null then raise exception 'Fórmula não encontrada ou inativa.'; end if;

  select coalesce(sum(case when unit = 'percent' then v_formula.base_batch_kg * amount / 100 else amount end), 0)
    into v_resolved
    from public.suplementacao_formula_items where formula_id = v_formula.id;

  if abs(v_resolved - v_formula.base_batch_kg) > 0.001 then
    raise exception 'A fórmula soma % kg e a batida base é de % kg. Corrija a fórmula antes de produzir.',
      round(v_resolved, 3), round(v_formula.base_batch_kg, 3);
  end if;

  v_factor := p_quantity_kg / v_formula.base_batch_kg;

  insert into public.suplementacao_productions (formula_id, product_id, quantity_kg, occurred_at, notes, recorded_by)
  values (v_formula.id, v_formula.product_id, p_quantity_kg, coalesce(p_occurred_at, now()), nullif(trim(coalesce(p_notes, '')), ''), v_actor)
  returning * into v_production;

  for v_item in
    select
      fi.item_id,
      p.name,
      round((case when fi.unit = 'percent' then v_formula.base_batch_kg * fi.amount / 100 else fi.amount end) * v_factor, 3) as quantity
    from public.suplementacao_formula_items fi
    join public.suplementacao_products p on p.id = fi.item_id
    where fi.formula_id = v_formula.id
  loop
    if v_item.quantity <= 0 then continue; end if;

    select coalesce(sum(quantity_kg), 0) into v_balance
      from public.suplementacao_stock_movements where product_id = v_item.item_id;

    if v_balance < v_item.quantity then
      raise exception 'Estoque insuficiente de %. Saldo: % / Necessário: %.',
        v_item.name, round(v_balance, 3), round(v_item.quantity, 3);
    end if;

    select coalesce(avg_unit_cost, 0) into v_cost
      from public.suplementacao_product_cost where product_id = v_item.item_id;
    v_cost := coalesce(v_cost, 0);
    v_total_cost := v_total_cost + v_item.quantity * v_cost;

    insert into public.suplementacao_production_items (production_id, item_id, quantity, unit_cost)
    values (v_production.id, v_item.item_id, v_item.quantity, v_cost);

    insert into public.suplementacao_stock_movements
      (product_id, kind, quantity_kg, unit_cost, occurred_at, production_id, recorded_by)
    values
      (v_item.item_id, 'consumption', -v_item.quantity, v_cost, v_production.occurred_at, v_production.id, v_actor);
  end loop;

  insert into public.suplementacao_stock_movements
    (product_id, kind, quantity_kg, unit_cost, occurred_at, production_id, recorded_by)
  values
    (v_production.product_id, 'yield', p_quantity_kg, round(v_total_cost / p_quantity_kg, 4), v_production.occurred_at, v_production.id, v_actor);

  update public.suplementacao_productions
     set total_cost = round(v_total_cost, 4)
   where id = v_production.id
  returning * into v_production;

  return v_production;
end;
$$;

create or replace function public.suplementacao_reverse_production(
  p_production_id uuid,
  p_reason text
) returns public.suplementacao_productions
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_production public.suplementacao_productions;
  v_balance numeric;
  v_item record;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para estornar fabricação.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do estorno.'; end if;

  select * into v_production from public.suplementacao_productions where id = p_production_id;
  if v_production.id is null then raise exception 'Fabricação não encontrada.'; end if;
  if v_production.reversed_at is not null then raise exception 'Esta fabricação já foi estornada.'; end if;

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = v_production.product_id;

  if v_balance < v_production.quantity_kg then
    raise exception 'O produto já foi consumido. Saldo: % kg / Estorno: % kg.',
      round(v_balance, 3), round(v_production.quantity_kg, 3);
  end if;

  for v_item in select * from public.suplementacao_production_items where production_id = v_production.id
  loop
    insert into public.suplementacao_stock_movements
      (product_id, kind, quantity_kg, unit_cost, occurred_at, reason, production_id, recorded_by)
    values
      (v_item.item_id, 'reversal', v_item.quantity, v_item.unit_cost, now(), trim(p_reason), v_production.id, v_actor);
  end loop;

  insert into public.suplementacao_stock_movements
    (product_id, kind, quantity_kg, occurred_at, production_id, reason, recorded_by)
  values
    (v_production.product_id, 'reversal', -v_production.quantity_kg, now(), v_production.id, trim(p_reason), v_actor);

  update public.suplementacao_productions
     set reversed_at = now(), reversed_by = v_actor, reversal_reason = trim(p_reason)
   where id = v_production.id
  returning * into v_production;

  return v_production;
end;
$$;

create or replace function public._suplementacao_feeding_movement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null then
    delete from public.suplementacao_stock_movements where feeding_record_id = new.id;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.suplementacao_stock_movements
      (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
    values
      (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
  else
    update public.suplementacao_stock_movements
       set product_id = new.product_id,
           quantity_kg = -new.quantity_kg,
           occurred_at = new.occurred_at
     where feeding_record_id = new.id;

    if not found then
      insert into public.suplementacao_stock_movements
        (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
      values
        (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
    end if;
  end if;
  return new;
end;
$$;

commit;
