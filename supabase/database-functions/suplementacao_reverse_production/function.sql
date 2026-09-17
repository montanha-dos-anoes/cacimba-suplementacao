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
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then raise exception 'Sem permissão para estornar fabricação.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do estorno.'; end if;

  select * into v_production from public.suplementacao_productions where id = p_production_id;
  if v_production.id is null then raise exception 'Fabricação não encontrada.'; end if;
  if v_production.reversed_at is not null then raise exception 'Esta fabricação já foi estornada.'; end if;

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
