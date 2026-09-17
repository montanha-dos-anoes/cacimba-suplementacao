begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.suplementacao_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  unit text not null default 'kg' check (unit in ('kg', 'l', 'sc')),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  created_by uuid references public.suplementacao_profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists suplementacao_ingredients_name_unique
  on public.suplementacao_ingredients (lower(trim(name))) where active;

create table if not exists public.suplementacao_ingredient_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.suplementacao_ingredients(id),
  kind text not null check (kind in ('entry', 'production', 'reversal', 'adjustment')),
  quantity numeric(14,3) not null check (quantity <> 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  occurred_at timestamptz not null default now(),
  supplier text,
  reason text,
  production_id uuid,
  notes text,
  recorded_by uuid not null references public.suplementacao_profiles(id),
  created_at timestamptz not null default now(),
  constraint suplementacao_ingredient_movements_direction check (
    (kind = 'entry' and quantity > 0)
    or (kind = 'production' and quantity < 0)
    or (kind = 'reversal' and quantity > 0)
    or kind = 'adjustment'
  ),
  constraint suplementacao_ingredient_movements_reason check (
    kind <> 'adjustment' or nullif(trim(coalesce(reason, '')), '') is not null
  )
);
create index if not exists suplementacao_ingredient_movements_ingredient_idx
  on public.suplementacao_ingredient_movements (ingredient_id, occurred_at desc);

create table if not exists public.suplementacao_formulas (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.suplementacao_products(id),
  name text not null check (length(trim(name)) > 0),
  base_batch_kg numeric(14,3) not null default 1000 check (base_batch_kg > 0),
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  notes text,
  created_by uuid references public.suplementacao_profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists suplementacao_formulas_active_product
  on public.suplementacao_formulas (product_id) where active;

create table if not exists public.suplementacao_formula_items (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.suplementacao_formulas(id) on delete cascade,
  ingredient_id uuid not null references public.suplementacao_ingredients(id),
  unit text not null check (unit in ('percent', 'kg')),
  amount numeric(14,4) not null check (amount > 0),
  position integer not null default 0,
  unique (formula_id, ingredient_id)
);

create table if not exists public.suplementacao_productions (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.suplementacao_formulas(id),
  product_id uuid not null references public.suplementacao_products(id),
  quantity_kg numeric(14,3) not null check (quantity_kg > 0),
  total_cost numeric(14,4) not null default 0,
  occurred_at timestamptz not null default now(),
  notes text,
  reversed_at timestamptz,
  reversed_by uuid references public.suplementacao_profiles(id),
  reversal_reason text,
  recorded_by uuid not null references public.suplementacao_profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists suplementacao_productions_occurred_idx on public.suplementacao_productions (occurred_at desc);

create table if not exists public.suplementacao_production_items (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.suplementacao_productions(id) on delete cascade,
  ingredient_id uuid not null references public.suplementacao_ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0
);

create table if not exists public.suplementacao_product_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.suplementacao_products(id),
  kind text not null check (kind in ('production', 'feeding', 'reversal', 'adjustment')),
  quantity_kg numeric(14,3) not null check (quantity_kg <> 0),
  occurred_at timestamptz not null default now(),
  production_id uuid references public.suplementacao_productions(id),
  feeding_record_id uuid references public.suplementacao_feeding_records(id) on delete cascade,
  reason text,
  recorded_by uuid references public.suplementacao_profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists suplementacao_product_movements_feeding_unique
  on public.suplementacao_product_movements (feeding_record_id) where feeding_record_id is not null;

create or replace view public.suplementacao_ingredient_cost as
select
  i.id as ingredient_id,
  case
    when coalesce(sum(m.quantity) filter (where m.kind = 'entry'), 0) > 0
    then sum(m.quantity * m.unit_cost) filter (where m.kind = 'entry')
       / sum(m.quantity) filter (where m.kind = 'entry')
    else 0
  end as avg_unit_cost
from public.suplementacao_ingredients i
left join public.suplementacao_ingredient_movements m on m.ingredient_id = i.id
group by i.id;

create or replace view public.suplementacao_ingredient_stock as
select
  i.id as ingredient_id,
  i.name,
  i.unit,
  i.min_stock,
  i.active,
  coalesce(sum(m.quantity), 0) as quantity,
  coalesce(sum(m.quantity), 0) < i.min_stock as below_min,
  coalesce(c.avg_unit_cost, 0) as avg_unit_cost
from public.suplementacao_ingredients i
left join public.suplementacao_ingredient_movements m on m.ingredient_id = i.id
left join public.suplementacao_ingredient_cost c on c.ingredient_id = i.id
group by i.id, c.avg_unit_cost;

create or replace view public.suplementacao_product_stock as
select
  p.id as product_id,
  p.name,
  p.active,
  coalesce(sum(m.quantity_kg), 0) as quantity_kg
from public.suplementacao_products p
left join public.suplementacao_product_movements m on m.product_id = p.id
group by p.id;

alter table public.suplementacao_ingredients enable row level security;
alter table public.suplementacao_ingredient_movements enable row level security;
alter table public.suplementacao_formulas enable row level security;
alter table public.suplementacao_formula_items enable row level security;
alter table public.suplementacao_productions enable row level security;
alter table public.suplementacao_production_items enable row level security;
alter table public.suplementacao_product_movements enable row level security;
commit;
