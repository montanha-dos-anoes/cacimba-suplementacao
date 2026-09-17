begin;

do $$
begin
  if to_regclass('public.suplementacao_lots') is null then
    raise exception 'PARE: suplementacao_lots nao existe. Rode 02-rename-legadas-suplementacao.sql antes do 25.';
  end if;
  if to_regclass('public.suplementacao_products') is null then
    raise exception 'PARE: suplementacao_products nao existe. Rode 02 e 13 antes do 25.';
  end if;
  if to_regclass('public.lot_versions') is null and to_regclass('public.suplementacao_lot_versions') is null then
    raise exception 'PARE: este banco nao tem lot_versions nem suplementacao_lot_versions.';
  end if;
  if to_regclass('public.lot_version_groups') is null and to_regclass('public.suplementacao_lot_version_groups') is null then
    raise exception 'PARE: este banco nao tem lot_version_groups nem suplementacao_lot_version_groups.';
  end if;
end $$;

do $$
begin
  if to_regclass('public.lot_versions') is not null and to_regclass('public.suplementacao_lot_versions') is null then
    alter table public.lot_versions rename to suplementacao_lot_versions;
  end if;
  if to_regclass('public.lot_version_groups') is not null and to_regclass('public.suplementacao_lot_version_groups') is null then
    alter table public.lot_version_groups rename to suplementacao_lot_version_groups;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'suplementacao_lot_version_groups_product_fkey'
       and conrelid = 'public.suplementacao_lot_version_groups'::regclass
  ) then
    alter table public.suplementacao_lot_version_groups
      add constraint suplementacao_lot_version_groups_product_fkey
      foreign key (product_id) references public.suplementacao_products(id);
  end if;
end $$;

update public.suplementacao_lot_version_groups g
   set product_id = p.id
  from public.suplementacao_products p
 where g.product_id is null
   and nullif(btrim(coalesce(g.product_name, '')), '') is not null
   and p.active
   and lower(btrim(p.name)) = lower(btrim(g.product_name));

do $$
declare
  v_orfas int;
  v_nomes text;
begin
  select count(*), string_agg(distinct btrim(product_name), ', ')
    into v_orfas, v_nomes
    from public.suplementacao_lot_version_groups
   where product_id is null;

  if v_orfas > 0 then
    raise notice 'ATENCAO: % categoria(s) de lote ficaram sem produto do estoque. Nomes soltos: %. Abra cada lote na tela Lotes e escolha o produto.', v_orfas, coalesce(v_nomes, '(vazio)');
  end if;
end $$;

drop policy if exists lot_versions_read on public.suplementacao_lot_versions;
drop policy if exists lot_versions_write on public.suplementacao_lot_versions;
drop policy if exists lot_versions_update on public.suplementacao_lot_versions;
drop policy if exists lot_version_groups_read on public.suplementacao_lot_version_groups;
drop policy if exists lot_version_groups_write on public.suplementacao_lot_version_groups;
drop policy if exists lot_version_groups_update on public.suplementacao_lot_version_groups;

do $$
declare item text;
begin
  foreach item in array array['suplementacao_lot_versions', 'suplementacao_lot_version_groups']
  loop
    execute format('alter table public.%I enable row level security', item);
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

drop function if exists public.save_lot_configuration(uuid, text, date, text, jsonb);

create or replace function public.suplementacao_save_lot_configuration(
  p_lot_id uuid,
  p_name text,
  p_effective_from date,
  p_note text,
  p_groups jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_lot_id uuid;
  v_version_id uuid;
  v_group jsonb;
  v_product_id uuid;
begin
  if v_actor is null then raise exception 'Sessão inválida.'; end if;
  if public._suplementacao_role() not in ('owner', 'admin') then
    raise exception 'Sem permissão para alterar lotes.';
  end if;
  if v_name is null then raise exception 'Informe o nome do lote.'; end if;
  if p_effective_from is null then raise exception 'Informe a data de vigência.'; end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'Adicione ao menos uma categoria.';
  end if;

  if exists (
    select 1 from public.suplementacao_lots
     where lower(btrim(name)) = lower(v_name)
       and (p_lot_id is null or id <> p_lot_id)
  ) then
    raise exception 'Já existe um lote com esse nome.';
  end if;

  if p_lot_id is null then
    insert into public.suplementacao_lots (name, created_by)
    values (v_name, v_actor)
    returning id into v_lot_id;
  else
    update public.suplementacao_lots set name = v_name where id = p_lot_id;
    if not found then raise exception 'Lote não encontrado.'; end if;
    v_lot_id := p_lot_id;
  end if;

  insert into public.suplementacao_lot_versions (lot_id, effective_from, created_by, note)
  values (v_lot_id, p_effective_from, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (lot_id, effective_from) do update
    set note = excluded.note
  returning id into v_version_id;

  delete from public.suplementacao_lot_version_groups
   where lot_version_id = v_version_id;

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if nullif(btrim(coalesce(v_group->>'category', '')), '') is null then
      raise exception 'Informe a categoria de todas as linhas.';
    end if;
    if (v_group->>'quantity')::integer < 0 then raise exception 'Quantidade de animais inválida.'; end if;
    if (v_group->>'avg_weight_kg')::numeric <= 0 then raise exception 'Peso médio inválido.'; end if;
    if nullif(v_group->>'expected_consumption_kg_head_day', '') is null
       or (v_group->>'expected_consumption_kg_head_day')::numeric < 0 then
      raise exception 'Informe o consumo esperado por cabeça de todas as linhas.';
    end if;

    v_product_id := nullif(v_group->>'product_id', '')::uuid;
    if v_product_id is null then raise exception 'Escolha o produto de todas as categorias.'; end if;
    if not exists (select 1 from public.suplementacao_products where id = v_product_id and active) then
      raise exception 'Produto da categoria não encontrado ou inativo.';
    end if;

    insert into public.suplementacao_lot_version_groups
      (lot_version_id, category, quantity, avg_weight_kg, product_id, product_name, expected_consumption_kg_head_day)
    select v_version_id,
           btrim(v_group->>'category'),
           (v_group->>'quantity')::integer,
           (v_group->>'avg_weight_kg')::numeric,
           v_product_id,
           p.name,
           (v_group->>'expected_consumption_kg_head_day')::numeric
      from public.suplementacao_products p
     where p.id = v_product_id;
  end loop;

  return v_lot_id;
end;
$$;

commit;
