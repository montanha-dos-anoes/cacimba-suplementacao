begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is null then
    raise exception 'PARE: rode 13-unificar-estoque.sql antes do 20.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'suplementacao_register_production'
       and pg_get_function_identity_arguments(p.oid) like '%p_allow_negative%'
  ) then
    raise exception 'PARE: rode 14-unidades-e-saldo-negativo.sql antes do 20 (as RPCs ainda nao tem p_allow_negative).';
  end if;
end $$;

create or replace function public.suplementacao_adjust_stock(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_allow_negative boolean default false
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_balance numeric;
  v_name text;
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para ajustar estoque.'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'Informe uma quantidade diferente de zero.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do ajuste.'; end if;

  select name into v_name from public.suplementacao_products where id = p_product_id;
  if v_name is null then raise exception 'Produto não encontrado.'; end if;

  perform pg_advisory_xact_lock(hashtext(p_product_id::text));

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = p_product_id;

  if v_balance + p_quantity < 0 and not coalesce(p_allow_negative, false) then
    raise exception 'SALDO_NEGATIVO'
      using detail = jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'balance', round(v_balance, 3),
        'needed', round(-p_quantity, 3),
        'result', round(v_balance + p_quantity, 3)
      )))::text;
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
  p_reason text default null,
  p_allow_negative boolean default false
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_balance numeric;
  v_name text;
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para registrar venda.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;

  select name into v_name from public.suplementacao_products where id = p_product_id;
  if v_name is null then raise exception 'Produto não encontrado.'; end if;

  perform pg_advisory_xact_lock(hashtext(p_product_id::text));

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = p_product_id;

  if v_balance - p_quantity < 0 and not coalesce(p_allow_negative, false) then
    raise exception 'SALDO_NEGATIVO'
      using detail = jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'balance', round(v_balance, 3),
        'needed', round(p_quantity, 3),
        'result', round(v_balance - p_quantity, 3)
      )))::text;
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
  p_notes text default null,
  p_allow_negative boolean default false
) returns public.suplementacao_productions
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_formula public.suplementacao_formulas;
  v_production public.suplementacao_productions;
  v_item record;
  v_factor numeric;
  v_resolved numeric;
  v_balance numeric;
  v_cost numeric;
  v_total_cost numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_lock record;
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

  for v_lock in
    select s.id from (
      select fi.item_id as id from public.suplementacao_formula_items fi
       where fi.formula_id = v_formula.id
      union
      select v_formula.product_id
    ) s order by s.id
  loop
    perform pg_advisory_xact_lock(hashtext(v_lock.id::text));
  end loop;

  for v_item in
    select fi.item_id, p.name,
      round((case when fi.unit = 'percent' then v_formula.base_batch_kg * fi.amount / 100 else fi.amount end) * v_factor, 3) as quantity
      from public.suplementacao_formula_items fi
      join public.suplementacao_products p on p.id = fi.item_id
     where fi.formula_id = v_formula.id
  loop
    if v_item.quantity <= 0 then continue; end if;

    select coalesce(sum(quantity_kg), 0) into v_balance
      from public.suplementacao_stock_movements where product_id = v_item.item_id;

    if v_balance - v_item.quantity < 0 then
      v_items := v_items || jsonb_build_object(
        'name', v_item.name,
        'balance', round(v_balance, 3),
        'needed', v_item.quantity,
        'result', round(v_balance - v_item.quantity, 3)
      );
    end if;
  end loop;

  if jsonb_array_length(v_items) > 0 and not coalesce(p_allow_negative, false) then
    raise exception 'SALDO_NEGATIVO' using detail = jsonb_build_object('items', v_items)::text;
  end if;

  insert into public.suplementacao_productions (formula_id, product_id, quantity_kg, occurred_at, notes, recorded_by)
  values (v_formula.id, v_formula.product_id, p_quantity_kg, coalesce(p_occurred_at, now()), nullif(trim(coalesce(p_notes, '')), ''), v_actor)
  returning * into v_production;

  for v_item in
    select fi.item_id, p.name,
      round((case when fi.unit = 'percent' then v_formula.base_batch_kg * fi.amount / 100 else fi.amount end) * v_factor, 3) as quantity
      from public.suplementacao_formula_items fi
      join public.suplementacao_products p on p.id = fi.item_id
     where fi.formula_id = v_formula.id
  loop
    if v_item.quantity <= 0 then continue; end if;

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
  p_reason text,
  p_allow_negative boolean default false
) returns public.suplementacao_productions
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_production public.suplementacao_productions;
  v_balance numeric;
  v_name text;
  v_item record;
  v_lock record;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para estornar fabricação.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do estorno.'; end if;

  select * into v_production from public.suplementacao_productions where id = p_production_id;
  if v_production.id is null then raise exception 'Fabricação não encontrada.'; end if;
  if v_production.reversed_at is not null then raise exception 'Esta fabricação já foi estornada.'; end if;

  for v_lock in
    select s.id from (
      select pi.item_id as id from public.suplementacao_production_items pi
       where pi.production_id = v_production.id
      union
      select v_production.product_id
    ) s order by s.id
  loop
    perform pg_advisory_xact_lock(hashtext(v_lock.id::text));
  end loop;

  select coalesce(sum(quantity_kg), 0) into v_balance
    from public.suplementacao_stock_movements where product_id = v_production.product_id;

  if v_balance - v_production.quantity_kg < 0 and not coalesce(p_allow_negative, false) then
    select name into v_name from public.suplementacao_products where id = v_production.product_id;
    raise exception 'SALDO_NEGATIVO'
      using detail = jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'balance', round(v_balance, 3),
        'needed', round(v_production.quantity_kg, 3),
        'result', round(v_balance - v_production.quantity_kg, 3)
      )))::text;
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

commit;
