-- 14-trato-zero.sql
--
-- PROBLEMA: registrar trato com 0 kg falha com
--   new row for relation "suplementacao_stock_movements" violates check constraint
--   "suplementacao_product_movements_quantity_kg_check"
--
-- CAUSA: o gatilho _suplementacao_feeding_movement cria um movimento de estoque
--   para todo trato, inclusive o de 0 kg. A coluna quantity_kg de
--   suplementacao_stock_movements tem check (quantity_kg <> 0), entao o banco
--   recusa o movimento e derruba o trato junto.
--
-- O QUE FAZ: trato de 0 kg passa a ser so leitura de cocho -- nao gera movimento
--   de estoque. Corrigir um trato para 0 apaga o movimento que existia, e
--   corrigir de 0 para um valor cria o movimento.
--
-- O QUE NAO FAZ: nao altera a constraint. Movimento de estoque com 0 kg continua
--   proibido, que e o certo: nao houve entrada nem saida.
--
-- SEGURO RODAR MAIS DE UMA VEZ.

begin;

do $$
begin
  if to_regclass('public.suplementacao_stock_movements') is null then
    raise exception 'PARE: suplementacao_stock_movements nao existe. Rode 04-unificar-estoque.sql antes.';
  end if;
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_suplementacao_feeding_movement'
  ) then
    raise exception 'PARE: a funcao _suplementacao_feeding_movement nao existe. Rode 04-unificar-estoque.sql antes.';
  end if;
end $$;

create or replace function public._suplementacao_feeding_movement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.product_id is null or coalesce(new.quantity_kg, 0) = 0 then
    delete from public.suplementacao_stock_movements where feeding_record_id = new.id;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.suplementacao_stock_movements
      (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
    values
      (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
  else
    update public.suplementacao_stock_movements
       set product_id = new.product_id,
           quantity_kg = -new.quantity_kg,
           occurred_at = new.occurred_at
     where feeding_record_id = new.id;

    if not found then
      insert into public.suplementacao_stock_movements
        (product_id, kind, quantity_kg, occurred_at, feeding_record_id, recorded_by)
      values
        (new.product_id, 'feeding', -new.quantity_kg, new.occurred_at, new.id, new.recorded_by);
    end if;
  end if;

  return new;
end;
$$;

commit;

-- CONFERENCIA: nenhuma destas consultas pode devolver linha.
-- 1) movimento de estoque preso a um trato de 0 kg:
select m.id, m.feeding_record_id, m.quantity_kg
  from public.suplementacao_stock_movements m
  join public.suplementacao_feeding_records f on f.id = m.feeding_record_id
 where coalesce(f.quantity_kg, 0) = 0;

-- 2) trato com produto e quantidade que ficou sem movimento:
select f.id, f.quantity_kg
  from public.suplementacao_feeding_records f
 where f.product_id is not null
   and coalesce(f.quantity_kg, 0) <> 0
   and not exists (
     select 1 from public.suplementacao_stock_movements m where m.feeding_record_id = f.id
   );
