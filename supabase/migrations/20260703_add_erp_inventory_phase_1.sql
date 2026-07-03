begin;

create extension if not exists pgcrypto;

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null default 'store',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_type_check
    check (type in ('store', 'warehouse', 'online', 'other'))
);

insert into public.inventory_locations (code, name, type, active, sort_order)
values ('MAIN_STORE', 'Main Store', 'store', true, 0)
on conflict (code) do update
set name = excluded.name,
    type = excluded.type,
    active = true,
    updated_at = now();

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null references public.products(id) on delete cascade,
  variant_sku text not null unique,
  barcode text,
  size text,
  color text,
  cost_price numeric(10,2),
  price numeric(10,2),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_variants_barcode_unique
on public.product_variants (barcode)
where barcode is not null and btrim(barcode) <> '';

create unique index if not exists product_variants_product_size_color_unique
on public.product_variants (
  product_id,
  coalesce(size, ''),
  coalesce(color, '')
);

create index if not exists product_variants_product_id_idx
on public.product_variants(product_id);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  quantity_on_hand integer not null default 0,
  quantity_reserved integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (variant_id, location_id),
  constraint inventory_balances_quantity_check
    check (
      quantity_on_hand >= 0
      and quantity_reserved >= 0
      and quantity_reserved <= quantity_on_hand
    )
);

create index if not exists inventory_balances_variant_id_idx
on public.inventory_balances(variant_id);

create index if not exists inventory_balances_location_id_idx
on public.inventory_balances(location_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  movement_type text not null,
  quantity_delta integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  reason text not null,
  source_type text,
  source_id text,
  idempotency_key text unique,
  created_by text,
  created_at timestamptz not null default now(),
  constraint stock_movements_type_check
    check (movement_type in (
      'initial_migration',
      'manual_adjustment',
      'sale',
      'return',
      'transfer_in',
      'transfer_out',
      'reservation',
      'release_reservation',
      'correction'
    )),
  constraint stock_movements_reason_not_blank_check
    check (btrim(reason) <> '')
);

create index if not exists stock_movements_variant_id_idx
on public.stock_movements(variant_id);

create index if not exists stock_movements_location_id_idx
on public.stock_movements(location_id);

create index if not exists stock_movements_created_at_idx
on public.stock_movements(created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx
on public.audit_logs(entity, entity_id);

create index if not exists audit_logs_created_at_idx
on public.audit_logs(created_at desc);

alter table public.inventory_locations enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.inventory_locations to service_role;
grant select, insert, update, delete on public.product_variants to service_role;
grant select, insert, update, delete on public.inventory_balances to service_role;
grant select, insert, update, delete on public.stock_movements to service_role;
grant select, insert, update, delete on public.audit_logs to service_role;

with main_location as (
  select id
  from public.inventory_locations
  where code = 'MAIN_STORE'
  limit 1
),
safe_products as (
  select
    p.*,
    case
      when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
      then p.size_stock
      else '{}'::jsonb
    end as safe_size_stock
  from public.products p
  where p.sku is not null and btrim(p.sku) <> ''
),
valid_size_rows as (
  select
    p.id as product_id,
    p.sku as product_sku,
    p.price,
    p.color,
    p.is_active,
    s.key as size,
    greatest(s.value::int, 0) as quantity,
    row_number() over (partition by p.id order by s.key) as sort_order
  from safe_products p
  cross join lateral jsonb_each_text(p.safe_size_stock) s(key, value)
  where s.value ~ '^-?[0-9]+$'
),
one_size_products as (
  select
    p.id as product_id,
    p.sku as product_sku,
    p.price,
    p.color,
    p.barcode,
    p.is_active,
    'ONE SIZE'::text as size,
    greatest(coalesce(p.stock, 0), 0) as quantity,
    0 as sort_order
  from safe_products p
  where not exists (
    select 1
    from valid_size_rows r
    where r.product_id = p.id
  )
),
all_variants as (
  select
    product_id,
    product_sku,
    null::text as barcode,
    size,
    color,
    price,
    coalesce(is_active, true) as active,
    sort_order,
    quantity,
    product_sku || '-' || upper(regexp_replace(size, '[^a-zA-Z0-9]+', '-', 'g')) as variant_sku
  from valid_size_rows
  union all
  select
    product_id,
    product_sku,
    nullif(btrim(barcode), '') as barcode,
    size,
    color,
    price,
    coalesce(is_active, true) as active,
    sort_order,
    quantity,
    product_sku as variant_sku
  from one_size_products
),
inserted_variants as (
  insert into public.product_variants (
    product_id,
    variant_sku,
    barcode,
    size,
    color,
    price,
    active,
    sort_order
  )
  select
    product_id,
    variant_sku,
    barcode,
    size,
    color,
    price,
    active,
    sort_order
  from all_variants
  on conflict (variant_sku) do update
  set
    product_id = excluded.product_id,
    barcode = excluded.barcode,
    size = excluded.size,
    color = excluded.color,
    price = excluded.price,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id, product_id, variant_sku, size
),
variant_quantities as (
  select
    iv.id as variant_id,
    ml.id as location_id,
    av.quantity
  from inserted_variants iv
  join all_variants av
    on av.variant_sku = iv.variant_sku
  cross join main_location ml
),
upsert_balances as (
  insert into public.inventory_balances (
    variant_id,
    location_id,
    quantity_on_hand,
    quantity_reserved,
    updated_at
  )
  select
    variant_id,
    location_id,
    quantity,
    0,
    now()
  from variant_quantities
  on conflict (variant_id, location_id) do update
  set
    quantity_on_hand = excluded.quantity_on_hand,
    quantity_reserved = least(public.inventory_balances.quantity_reserved, excluded.quantity_on_hand),
    updated_at = now()
  returning variant_id, location_id, quantity_on_hand
)
insert into public.stock_movements (
  variant_id,
  location_id,
  movement_type,
  quantity_delta,
  quantity_before,
  quantity_after,
  reason,
  source_type,
  source_id,
  idempotency_key,
  created_by
)
select
  b.variant_id,
  b.location_id,
  'initial_migration',
  b.quantity_on_hand,
  0,
  b.quantity_on_hand,
  'Initial migration from products.stock / products.size_stock',
  'migration',
  'erp_phase_1',
  'initial_migration:' || b.variant_id::text || ':' || b.location_id::text,
  'system'
from upsert_balances b
on conflict (idempotency_key) do nothing;

commit;
