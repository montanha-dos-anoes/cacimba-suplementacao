-- =============================================================================
-- 02 - RENOMEIA TABELAS LEGADAS DA SUPLEMENTACAO PARA suplementacao_*
-- =============================================================================
-- O QUE FAZ: renomeia profiles/lots/products/feeding_records para
--            suplementacao_profiles/suplementacao_lots/suplementacao_products/
--            suplementacao_feeding_records (ALTER TABLE ... RENAME TO, sem
--            perder linha nem indice/PK/FK/unique -- tudo isso segue o nome
--            novo automaticamente, Postgres nao precisa de recriacao;
--            renomear a PK e as uniques por clareza e opcional e NAO e
--            feito aqui, para manter o script minimo). Recria as 9 funcoes
--            que citam essas 4 tabelas, ja apontando para os nomes novos --
--            handle_new_auth_user, is_admin_or_owner, is_owner, current_role,
--            claim_first_owner, correct_feeding_record,
--            correct_feeding_record_v2, delete_feeding_record_v2,
--            sync_feeding_records_v2. As 9 sao copia literal do
--            pg_get_functiondef de PROD (coletado em 2026-09-11 via o PASSO 0
--            abaixo, rodado pelo cliente contra kwogzwdidzenfmdxmiwv) --
--            SOMENTE os nomes das 4 tabelas foram trocados no corpo, nenhuma
--            outra linha de logica foi alterada. Termina com bloco de
--            conferencia (contagem de linhas + lista de funcoes existentes
--            em public) e uma trava automatica que aborta o COMMIT se
--            alguma das 4 funcoes de correcao/exclusao/sync ainda citar as
--            tabelas antigas sem prefixo.
--
-- ATENCAO -- COMPORTAMENTO HERDADO DE PROD QUE AFETA TESTE NO DEV:
--   claim_first_owner() (corpo real de PROD, ver abaixo) so deixa a conta
--   com e-mail 'willianterceros@gmail.com' virar owner -- e um gate
--   hardcoded no proprio corpo da funcao, nao foi inventado aqui. Pra
--   cadastrar o primeiro usuario de teste no DEV e ele virar owner, o
--   cadastro precisa ser feito com esse e-mail exato. Qualquer outro
--   e-mail recebe 'Only the primary owner account can claim ownership' e
--   fica sempre com role 'field'. Se for indesejado pra teste no DEV, isso
--   precisa de uma decisao separada do cliente (nao alterado aqui sem
--   pedido -- e o corpo real de producao).
--
-- ESTRUTURA DO SCRIPT:
--   PASSO 0 (fora de transacao, antes do BEGIN) -- SELECT com
--     pg_get_functiondef cobrindo as 9 funcoes. Ja foi rodado pelo cliente
--     contra PROD em 2026-09-11 pra gerar o PASSO 2 abaixo; fica no script
--     pra auditoria e pra rodar de novo antes da fase S4, caso as funcoes
--     tenham mudado em PROD desde entao (se mudou, atualizar o PASSO 2
--     antes de aplicar em PROD).
--   PASSO 1 -- rename das 4 tabelas legadas.
--   PASSO 2 -- recria as 9 funcoes (corpo literal de PROD, so tabela
--     renomeada).
--   PASSO 3 -- bloco de conferencia (contagem das 4 tabelas + lista de
--     funcoes) e a trava automatica antes do COMMIT.
--
-- O QUE NAO FAZ: nao mexe em feeding_record_edits nem feeding_record_deletions
--                (ficam com o nome atual -- fora do escopo desta tarefa, sao
--                usadas pelas 4 funcoes de correcao/exclusao/sync de trato).
--                Nao toca a Edge Function 'admin-users' (codigo fora deste
--                repo, roda no Supabase -- fica pendente para quando o
--                cliente publicar a funcao nova, nao e arquivo deste repo).
--                Nao altera o gate de e-mail hardcoded em claim_first_owner
--                (ver ATENCAO acima).
--
-- ROLLBACK: se a trava do PASSO 3 abortar, nao ha o que desfazer (a
--   transacao inteira e revertida sozinha). Se o script COMMITAR com
--   sucesso e for preciso desfazer depois -- renomear de volta:
--   alter table public.suplementacao_profiles        rename to profiles;
--   alter table public.suplementacao_lots             rename to lots;
--   alter table public.suplementacao_products          rename to products;
--   alter table public.suplementacao_feeding_records   rename to feeding_records;
--   e recriar as 9 funcoes com o corpo antigo (citando os nomes sem
--   prefixo -- o texto original de cada uma esta no resultado do PASSO 0
--   coletado em 2026-09-11, guardado fora deste repo).
--   Nenhuma linha e perdida em nenhuma direcao -- e sempre RENAME, nunca
--   DROP TABLE.
--
-- ONDE RODAR: primeiro no projeto DEV (xfdirruvwqvyuchnelbf). Validar o
--   bloco de conferencia do PASSO 3 -- esperado em DEV: todas as contagens
--   em 0 (DEV ainda nao tem dado de suplementacao). So rodar em PROD
--   (kwogzwdidzenfmdxmiwv) na fase S4 do plano, com "ok" explicito do
--   cliente -- em PROD o esperado e 14 / 18 / 3 / 108 linhas em
--   profiles / lots / products / feeding_records (nessa ordem). Antes de
--   rodar em PROD, rodar o PASSO 0 de novo e conferir se alguma das 9
--   funcoes mudou desde 2026-09-11 -- se mudou, atualizar o corpo abaixo
--   primeiro.
-- =============================================================================


select proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('correct_feeding_record','correct_feeding_record_v2','delete_feeding_record_v2','sync_feeding_records_v2','handle_new_auth_user','is_admin_or_owner','is_owner','current_role','claim_first_owner');


begin;

alter table public.profiles        rename to suplementacao_profiles;
alter table public.lots            rename to suplementacao_lots;
alter table public.products        rename to suplementacao_products;
alter table public.feeding_records rename to suplementacao_feeding_records;


create or replace function public.handle_new_auth_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.suplementacao_profiles (id, full_name, email, role, active, protected_owner)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1), 'Usuário'),
    new.email,
    'field',
    true,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.is_admin_or_owner()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select role in ('owner','admin') from public.suplementacao_profiles where id = auth.uid() and active = true), false);
$function$;

create or replace function public.is_owner()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select role = 'owner' from public.suplementacao_profiles where id = auth.uid() and active = true), false);
$function$;

create or replace function public."current_role"()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select role from public.suplementacao_profiles where id = auth.uid() and active = true;
$function$;

create or replace function public.claim_first_owner()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  if lower(coalesce(v_email,'')) <> 'willianterceros@gmail.com' then
    raise exception 'Only the primary owner account can claim ownership';
  end if;
  if exists (select 1 from public.suplementacao_profiles where role='owner' and active=true) then
    return;
  end if;
  update public.suplementacao_profiles
  set role='owner', protected_owner=true, active=true, full_name=coalesce(nullif(full_name,''),'Willian')
  where id=auth.uid();
end;
$function$;

create or replace function public.correct_feeding_record(p_record_id uuid, p_lot_id uuid, p_product_id uuid, p_quantity_kg numeric, p_trough_reading text, p_notes text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.suplementacao_feeding_records%rowtype;
  caller_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into r from public.suplementacao_feeding_records where id=p_record_id;
  if not found then raise exception 'Registro não encontrado'; end if;
  select role into caller_role from public.suplementacao_profiles where id=auth.uid() and active=true;
  if caller_role is null then raise exception 'Usuário inativo ou inválido'; end if;
  if caller_role='field' then
    if r.recorded_by <> auth.uid() then raise exception 'Você só pode corrigir seus próprios lançamentos'; end if;
    if now() > r.created_at + interval '30 minutes' then raise exception 'Prazo de 30 minutos para correção expirado'; end if;
  elsif caller_role not in ('admin','owner') then
    raise exception 'Sem permissão';
  end if;
  if p_quantity_kg is null or p_quantity_kg < 0 then raise exception 'Quantidade inválida'; end if;
  if p_trough_reading not in ('empty','medium','full') then raise exception 'Leitura do cocho inválida'; end if;
  insert into public.feeding_record_edits(feeding_record_id,edited_by,old_lot_id,new_lot_id,old_product_id,new_product_id,old_quantity_kg,new_quantity_kg,old_trough_reading,new_trough_reading,old_notes,new_notes)
  values(r.id,auth.uid(),r.lot_id,p_lot_id,r.product_id,p_product_id,r.quantity_kg,p_quantity_kg,r.trough_reading,p_trough_reading,r.notes,p_notes);
  update public.suplementacao_feeding_records set lot_id=p_lot_id,product_id=p_product_id,quantity_kg=p_quantity_kg,trough_reading=p_trough_reading,notes=p_notes,edited_at=now(),edited_by=auth.uid() where id=p_record_id;
end;
$function$;

create or replace function public.correct_feeding_record_v2(p_record_id uuid, p_lot_id uuid, p_product_name text, p_quantity_kg numeric, p_trough_reading text, p_notes text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.suplementacao_feeding_records%rowtype;
  caller_role text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into r from public.suplementacao_feeding_records where id=p_record_id;
  if not found then raise exception 'Registro não encontrado'; end if;
  select role into caller_role from public.suplementacao_profiles where id=auth.uid() and active=true;
  if caller_role is null then raise exception 'Usuário inativo ou inválido'; end if;
  if caller_role='field' then
    if r.recorded_by<>auth.uid() then raise exception 'Você só pode corrigir seus próprios lançamentos'; end if;
    if now()>r.created_at+interval '30 minutes' then raise exception 'Prazo de 30 minutos para correção expirado'; end if;
  elsif caller_role not in ('admin','owner') then raise exception 'Sem permissão'; end if;
  if nullif(btrim(p_product_name),'') is null then raise exception 'Produto inválido'; end if;
  if p_quantity_kg is null or p_quantity_kg<0 then raise exception 'Quantidade inválida'; end if;
  if p_trough_reading not in ('empty','medium','full') then raise exception 'Leitura do cocho inválida'; end if;

  insert into public.feeding_record_edits(feeding_record_id,edited_by,old_lot_id,new_lot_id,old_product_id,new_product_id,old_product_name,new_product_name,old_quantity_kg,new_quantity_kg,old_trough_reading,new_trough_reading,old_notes,new_notes)
  values(r.id,auth.uid(),r.lot_id,p_lot_id,r.product_id,null,coalesce(r.product_name,(select name from public.suplementacao_products where id=r.product_id)),btrim(p_product_name),r.quantity_kg,p_quantity_kg,r.trough_reading,p_trough_reading,r.notes,p_notes);

  update public.suplementacao_feeding_records set lot_id=p_lot_id,product_id=null,product_name=btrim(p_product_name),quantity_kg=p_quantity_kg,trough_reading=p_trough_reading,notes=p_notes,edited_at=now(),edited_by=auth.uid() where id=p_record_id;
end;
$function$;

create or replace function public.delete_feeding_record_v2(p_record_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_row public.suplementacao_feeding_records%rowtype;
  v_lot_name text;
  v_recorder_name text;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select role, full_name into v_role, v_name
  from public.suplementacao_profiles
  where id = v_uid and active = true;

  if v_role is null then
    raise exception 'Usuário sem permissão.';
  end if;

  select * into v_row
  from public.suplementacao_feeding_records
  where id = p_record_id
  for update;

  if not found then
    return true;
  end if;

  if v_role not in ('owner','admin') then
    if v_role <> 'field' or v_row.recorded_by <> v_uid or now() > v_row.created_at + interval '30 minutes' then
      raise exception 'Este lançamento não pode mais ser excluído pelo perfil de campo.';
    end if;
  end if;

  select name into v_lot_name from public.suplementacao_lots where id = v_row.lot_id;
  select full_name into v_recorder_name from public.suplementacao_profiles where id = v_row.recorded_by;

  insert into public.feeding_record_deletions(
    original_record_id, occurred_at, lot_id, lot_name, product_id, product_name,
    quantity_kg, trough_reading, recorded_by, recorder_name, notes,
    original_created_at, original_edited_at, original_edited_by,
    deleted_by, deleter_name
  ) values (
    v_row.id, v_row.occurred_at, v_row.lot_id, v_lot_name, v_row.product_id, v_row.product_name,
    v_row.quantity_kg, v_row.trough_reading, v_row.recorded_by, v_recorder_name, v_row.notes,
    v_row.created_at, v_row.edited_at, v_row.edited_by,
    v_uid, v_name
  );

  delete from public.suplementacao_feeding_records where id = p_record_id;
  return true;
end;
$function$;

create or replace function public.sync_feeding_records_v2(p_records jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_active boolean;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select active into v_active from public.suplementacao_profiles where id = v_uid;
  if coalesce(v_active,false) is not true then
    raise exception 'Usuário inativo.';
  end if;

  insert into public.suplementacao_feeding_records
    (id, occurred_at, lot_id, product_id, product_name, quantity_kg, trough_reading, recorded_by, notes)
  select
    coalesce(r.id, gen_random_uuid()),
    r.occurred_at,
    r.lot_id,
    r.product_id,
    r.product_name,
    r.quantity_kg,
    r.trough_reading,
    v_uid,
    r.notes
  from jsonb_to_recordset(coalesce(p_records,'[]'::jsonb)) as r(
    id uuid,
    occurred_at timestamptz,
    lot_id uuid,
    product_id uuid,
    product_name text,
    quantity_kg numeric,
    trough_reading text,
    recorded_by uuid,
    notes text
  )
  where r.occurred_at is not null
    and r.lot_id is not null
    and r.quantity_kg is not null
    and r.quantity_kg >= 0
    and r.trough_reading in ('empty','medium','full')
  on conflict (id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;


select 'suplementacao_profiles'        as tabela, count(*) from public.suplementacao_profiles
union all select 'suplementacao_lots',            count(*) from public.suplementacao_lots
union all select 'suplementacao_products',        count(*) from public.suplementacao_products
union all select 'suplementacao_feeding_records', count(*) from public.suplementacao_feeding_records;

select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('handle_new_auth_user','is_admin_or_owner','is_owner','current_role','claim_first_owner',
  'correct_feeding_record','correct_feeding_record_v2','delete_feeding_record_v2','sync_feeding_records_v2');

do $$
declare
  bad text;
begin
  select proname into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('correct_feeding_record','correct_feeding_record_v2','delete_feeding_record_v2','sync_feeding_records_v2')
    and pg_get_functiondef(p.oid) ~* '\mprofiles\M|\mfeeding_records\M|\mlots\M|\mproducts\M'
  limit 1;

  if bad is not null then
    raise exception 'PASSO 2 nao aplicado corretamente -- % ainda cita profiles/lots/products/feeding_records sem o prefixo suplementacao_. Transacao abortada, nada foi alterado.', bad;
  end if;
end $$;

commit;
