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
