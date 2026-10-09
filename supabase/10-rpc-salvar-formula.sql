begin;

do $$
begin
  if to_regclass('public.suplementacao_formula_items') is null then
    raise exception 'PARE: rode 13-unificar-estoque.sql antes do 22.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'suplementacao_formula_items'
       and column_name = 'item_id'
  ) then
    raise exception 'PARE: suplementacao_formula_items ainda usa ingredient_id. Rode 13-unificar-estoque.sql antes do 22.';
  end if;
end $$;

create or replace function public.suplementacao_save_formula(
  p_product_id uuid,
  p_new_product_name text,
  p_name text,
  p_items jsonb
) returns public.suplementacao_formulas
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_new_name text := nullif(trim(coalesce(p_new_product_name, '')), '');
  v_product_id uuid := p_product_id;
  v_total numeric;
  v_count int;
  v_distinct int;
  v_bad int;
  v_previous public.suplementacao_formulas;
  v_version int := 1;
  v_formula public.suplementacao_formulas;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then
    raise exception 'Sem permissão para salvar fórmula.';
  end if;
  if v_name is null then raise exception 'Informe o nome da fórmula.'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua pelo menos um item na fórmula.';
  end if;

  select count(*),
         count(distinct (elem->>'item_id')),
         count(*) filter (
           where nullif(elem->>'item_id', '') is null
              or (elem->>'amount')::numeric is null
              or (elem->>'amount')::numeric <= 0
         ),
         coalesce(sum((elem->>'amount')::numeric), 0)
    into v_count, v_distinct, v_bad, v_total
    from jsonb_array_elements(p_items) elem;

  if v_bad > 0 then
    raise exception 'Informe o item e uma quantidade maior que zero em todas as linhas.';
  end if;
  if v_count <> v_distinct then
    raise exception 'O mesmo item não pode aparecer duas vezes na fórmula.';
  end if;
  if abs(v_total - 100) > 0.001 then
    raise exception 'A fórmula soma %%% e precisa fechar 100%%.', round(v_total, 3);
  end if;

  if v_product_id is null then
    if v_new_name is null then
      raise exception 'Informe o nome do produto que essa fórmula fabrica.';
    end if;
    select id into v_product_id
      from public.suplementacao_products
     where active and lower(trim(name)) = lower(v_new_name)
     limit 1;
    if v_product_id is null then
      insert into public.suplementacao_products (name, created_by)
      values (v_new_name, v_actor)
      returning id into v_product_id;
    end if;
  else
    if not exists (select 1 from public.suplementacao_products where id = v_product_id and active) then
      raise exception 'Produto fabricado não encontrado ou inativo.';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
     where (elem->>'item_id')::uuid = v_product_id
  ) then
    raise exception 'O produto de saída da fórmula não pode ser um item de entrada da mesma fórmula.';
  end if;

  select * into v_previous
    from public.suplementacao_formulas
   where product_id = v_product_id and active
   limit 1;

  if v_previous.id is not null then
    v_version := v_previous.version + 1;
    update public.suplementacao_formulas set active = false where id = v_previous.id;
  end if;

  insert into public.suplementacao_formulas
    (product_id, name, base_batch_kg, version, created_by)
  values
    (v_product_id, v_name, 100, v_version, v_actor)
  returning * into v_formula;

  insert into public.suplementacao_formula_items (formula_id, item_id, unit, amount, position)
  select v_formula.id,
         (elem->>'item_id')::uuid,
         'percent',
         (elem->>'amount')::numeric,
         (ord - 1)::int
    from jsonb_array_elements(p_items) with ordinality as t(elem, ord);

  return v_formula;
end;
$$;

commit;
