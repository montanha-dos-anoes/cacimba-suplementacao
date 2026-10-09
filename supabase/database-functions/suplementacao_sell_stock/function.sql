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
