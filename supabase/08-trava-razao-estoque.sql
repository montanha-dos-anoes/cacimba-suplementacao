begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is null then
    raise exception 'PARE: rode 13-unificar-estoque.sql antes do 19.';
  end if;
end $$;

drop policy if exists suplementacao_stock_movements_write on public.suplementacao_stock_movements;
drop policy if exists suplementacao_stock_movements_insert on public.suplementacao_stock_movements;

create policy suplementacao_stock_movements_insert on public.suplementacao_stock_movements
  for insert to authenticated
  with check (public._suplementacao_role() in ('owner', 'admin'));

do $$
declare item text;
begin
  foreach item in array array['suplementacao_productions', 'suplementacao_production_items']
  loop
    execute format('drop policy if exists %I on public.%I', item || '_write', item);
    execute format('drop policy if exists %I on public.%I', item || '_insert', item);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public._suplementacao_role() in (''owner'', ''admin''))',
      item || '_insert', item
    );
  end loop;
end $$;

create or replace function public.suplementacao_fix_entry_cost(
  p_movement_id uuid,
  p_unit_cost numeric
) returns public.suplementacao_stock_movements
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_movement public.suplementacao_stock_movements;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then
    raise exception 'Sem permissão para corrigir valor de entrada.';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Informe um valor por kg maior ou igual a zero.';
  end if;

  select * into v_movement
    from public.suplementacao_stock_movements where id = p_movement_id;
  if v_movement.id is null then
    raise exception 'Movimento não encontrado.';
  end if;
  if v_movement.kind <> 'entry' then
    raise exception 'Só é possível corrigir o valor de movimentos de entrada.';
  end if;

  update public.suplementacao_stock_movements
     set unit_cost = p_unit_cost
   where id = p_movement_id
  returning * into v_movement;

  return v_movement;
end;
$$;

commit;
