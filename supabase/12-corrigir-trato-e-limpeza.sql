begin;

do $$
begin
  if to_regclass('public.suplementacao_feeding_records') is null then
    raise exception 'PARE: rode 02-rename-legadas-suplementacao.sql antes do 24.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'correct_feeding_record') then
    raise exception 'PARE: a funcao correct_feeding_record (v1) nao existe neste banco. Ela e a que o app passa a usar -- nao remova a v2 sem ela. Rode 02-rename-legadas-suplementacao.sql antes do 24.';
  end if;
end $$;

drop function if exists public.correct_feeding_record_v2(uuid, uuid, text, numeric, text, text);

drop policy if exists products_admin_delete on public.suplementacao_products;

commit;
