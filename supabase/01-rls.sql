begin;

create or replace function public._suplementacao_role()
returns text language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.suplementacao_profiles where id = auth.uid() and active limit 1;
$$;

do $$
declare item text;
begin
  foreach item in array array[
    'suplementacao_ingredients', 'suplementacao_ingredient_movements', 'suplementacao_formulas',
    'suplementacao_formula_items', 'suplementacao_productions', 'suplementacao_production_items', 'suplementacao_product_movements'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', item || '_read', item);
    execute format('drop policy if exists %I on public.%I', item || '_write', item);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public._suplementacao_role() is not null)',
      item || '_read', item
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public._suplementacao_role() in (''owner'', ''admin'')) with check (public._suplementacao_role() in (''owner'', ''admin''))',
      item || '_write', item
    );
  end loop;
end $$;

grant select on public.suplementacao_ingredient_stock, public.suplementacao_ingredient_cost, public.suplementacao_product_stock to authenticated;
commit;
