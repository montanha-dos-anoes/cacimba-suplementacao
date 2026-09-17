begin;

do $$
begin
  if to_regclass('public.suplementacao_feeding_records') is null then
    raise exception 'PARE: as tabelas legadas ainda nao foram renomeadas. Rode 02-rename-legadas-suplementacao.sql antes do 23.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'is_admin_or_owner') then
    raise exception 'PARE: a funcao is_admin_or_owner() nao existe. Rode 02-rename-legadas-suplementacao.sql antes do 23.';
  end if;
end $$;

alter table public.suplementacao_profiles        enable row level security;
alter table public.suplementacao_lots            enable row level security;
alter table public.suplementacao_products        enable row level security;
alter table public.suplementacao_feeding_records enable row level security;

-- ---------------------------------------------------------------------------
-- suplementacao_profiles
--   Leitura: o proprio perfil, ou qualquer um se for admin/owner.
--   Update: so o owner.
--   Insert: bloqueado para todos (check false) -- quem cria perfil e o gatilho
--           handle_new_auth_user(), que e security definer e passa por cima.
--   Delete: nenhuma policy -> ninguem apaga perfil pela API.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_read_self_or_admin on public.suplementacao_profiles;
create policy profiles_read_self_or_admin on public.suplementacao_profiles
  for select using (((id = auth.uid()) or is_admin_or_owner()));

drop policy if exists profiles_owner_manage on public.suplementacao_profiles;
create policy profiles_owner_manage on public.suplementacao_profiles
  for update using (is_owner()) with check (is_owner());

drop policy if exists profiles_owner_insert_none on public.suplementacao_profiles;
create policy profiles_owner_insert_none on public.suplementacao_profiles
  for insert with check (false);

-- ---------------------------------------------------------------------------
-- suplementacao_lots
--   Leitura: qualquer usuario autenticado (o perfil Campo precisa escolher
--            o lote na tela de trato).
--   Insert/Update: admin/owner.
--   Delete: nenhuma policy -> lote nao se apaga, so se desativa.
-- ---------------------------------------------------------------------------
drop policy if exists lots_read_authenticated on public.suplementacao_lots;
create policy lots_read_authenticated on public.suplementacao_lots
  for select using ((auth.uid() is not null));

drop policy if exists lots_admin_insert on public.suplementacao_lots;
create policy lots_admin_insert on public.suplementacao_lots
  for insert with check (is_admin_or_owner());

drop policy if exists lots_admin_update on public.suplementacao_lots;
create policy lots_admin_update on public.suplementacao_lots
  for update using (is_admin_or_owner()) with check (is_admin_or_owner());

-- ---------------------------------------------------------------------------
-- suplementacao_products
--   Leitura: qualquer usuario autenticado (Campo escolhe o produto no trato).
--   Insert/Update/Delete: admin/owner.
--   Ver OBSERVACAO 1 no rodape sobre o delete.
-- ---------------------------------------------------------------------------
drop policy if exists products_read_authenticated on public.suplementacao_products;
create policy products_read_authenticated on public.suplementacao_products
  for select using ((auth.uid() is not null));

drop policy if exists products_admin_insert on public.suplementacao_products;
create policy products_admin_insert on public.suplementacao_products
  for insert with check (is_admin_or_owner());

drop policy if exists products_admin_update on public.suplementacao_products;
create policy products_admin_update on public.suplementacao_products
  for update using (is_admin_or_owner()) with check (is_admin_or_owner());

drop policy if exists products_admin_delete on public.suplementacao_products;
create policy products_admin_delete on public.suplementacao_products
  for delete using (is_admin_or_owner());

-- ---------------------------------------------------------------------------
-- suplementacao_feeding_records
--   Leitura: admin/owner ve tudo; Campo ve so o que ele mesmo lancou.
--   Insert: usuario ativo, e so em nome dele mesmo (auth.uid() = recorded_by).
--   Update/Delete: nenhuma policy. Ver OBSERVACAO 2 no rodape.
-- ---------------------------------------------------------------------------
drop policy if exists feeding_admin_read_all on public.suplementacao_feeding_records;
create policy feeding_admin_read_all on public.suplementacao_feeding_records
  for select using (is_admin_or_owner());

drop policy if exists feeding_field_read_own on public.suplementacao_feeding_records;
create policy feeding_field_read_own on public.suplementacao_feeding_records
  for select using ((recorded_by = auth.uid()));

drop policy if exists feeding_insert_active_user on public.suplementacao_feeding_records;
create policy feeding_insert_active_user on public.suplementacao_feeding_records
  for insert with check (
    ((auth.uid() = recorded_by) and (exists (
      select 1 from public.suplementacao_profiles p
       where ((p.id = auth.uid()) and (p.active = true))
    )))
  );

commit;

-- =============================================================================
-- CONFERENCIA (rode depois; esperado: 13 linhas, 4 tabelas, todas com rls ligada)
-- =============================================================================
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('suplementacao_profiles','suplementacao_lots',
--                        'suplementacao_products','suplementacao_feeding_records')
--    order by tablename, policyname;
--
-- =============================================================================
-- OBSERVACOES -- coisas que o dump revelou e que valem decisao sua.
-- Nenhuma foi alterada aqui: este script e copia fiel do DEV.
-- =============================================================================
--
-- OBSERVACAO 1 -- products_admin_delete permite APAGAR produto.
--   Um produto com movimento de estoque nao apaga (a FK de
--   suplementacao_stock_movements barra). Mas um produto recem-criado, ainda
--   sem movimento, apaga sim -- e some da lista sem deixar rastro. O app nao
--   tem botao de apagar produto (so Desativar), entao esta policy nao e usada
--   por tela nenhuma. Candidata a ser removida, se voce quiser.
--
-- OBSERVACAO 2 -- trato lancado errado nao tem conserto pela tela.
--   suplementacao_feeding_records nao tem policy de UPDATE nem de DELETE.
--   Ou seja: nem o funcionario de campo nem o administrador conseguem
--   corrigir ou apagar um trato pela API. Existem no banco as funcoes
--   legadas correct_feeding_record, correct_feeding_record_v2 e
--   delete_feeding_record_v2 (security definer, passam por cima da RLS, com
--   regra de 30 minutos para o perfil Campo) -- mas **nenhuma tela do app
--   chama essas funcoes hoje**. Na pratica, quantidade digitada errada fica
--   errada, e o estoque baixado errado tambem.
--   Isso e uma lacuna de funcionalidade, nao de permissao: a correcao ja
--   existe no banco, falta a tela. Vale decidir se entra.
