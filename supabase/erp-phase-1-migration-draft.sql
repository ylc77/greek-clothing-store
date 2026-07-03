-- ERP Phase 1 inventory migration draft
-- Status: draft only. Review before execution.
--
-- Scope:
-- 1. Add product_variants, inventory_locations, inventory_balances,
--    stock_movements, audit_logs.
-- 2. Keep products.stock and products.size_stock as compatibility/cache fields.
-- 3. Do not switch storefront/admin stock logic in this migration.
-- 4. Keep USE_VARIANT_INVENTORY=false until code is ready.
--
-- Variant SKU rule:
-- - ONE SIZE products use the original products.sku.
-- - Sized products use products.sku || '-' || normalized size.
--   Example: SKU001 + M => SKU001-M.
-- Reason:
-- - ONE SIZE keeps old SKU/barcode/Skroutz/CSV compatibility.
-- - Sized variants need a stable per-size identifier.
--
-- RLS:
-- - RLS is enabled.
-- - No public policies are created in phase 1.
-- - These tables are intended for server-side service role access only
--   until ERP/POS features are explicitly enabled.

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
  product_id uuid not null references public.products(id) on delete cascade,
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

commit;

-- ---------------------------------------------------------------------------
-- Pre-migration checks
-- Run these before applying the schema and data migration.
-- Any returned rows should be reviewed before continuing.
-- ---------------------------------------------------------------------------

-- Empty SKU
select id, sku
from public.products
where sku is null or btrim(sku) = '';

-- Duplicate SKU
select sku, count(*)
from public.products
where sku is not null and btrim(sku) <> ''
group by sku
having count(*) > 1;

-- Duplicate barcode
select barcode, count(*)
from public.products
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;

-- Duplicate ean
select ean, count(*)
from public.products
where ean is not null and btrim(ean) <> ''
group by ean
having count(*) > 1;

-- size_stock is not an object
select id, sku, size_stock
from public.products
where size_stock is not null
  and jsonb_typeof(size_stock) <> 'object';

-- size_stock quantity is not an integer
select p.id, p.sku, s.key as size, s.value as quantity
from public.products p
cross join lateral jsonb_each_text(
  case
    when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
    then p.size_stock
    else '{}'::jsonb
  end
) s(key, value)
where s.value !~ '^-?[0-9]+$';

-- size_stock contains negative quantity
select p.id, p.sku, s.key as size, s.value as quantity
from public.products p
cross join lateral jsonb_each_text(
  case
    when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
    then p.size_stock
    else '{}'::jsonb
  end
) s(key, value)
where s.value ~ '^-?[0-9]+$'
  and s.value::int < 0;

-- products.stock is negative
select id, sku, stock
from public.products
where coalesce(stock, 0) < 0;

-- products.stock does not match size_stock total.
-- If this returns rows, decide whether products.stock or size_stock is correct.
select
  p.id,
  p.sku,
  coalesce(p.stock, 0) as product_stock,
  coalesce(sum(s.value::int), 0) as size_stock_total,
  p.size_stock
from public.products p
cross join lateral jsonb_each_text(
  case
    when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
    then p.size_stock
    else '{}'::jsonb
  end
) s(key, value)
where s.value ~ '^-?[0-9]+$'
group by p.id, p.sku, p.stock, p.size_stock
having coalesce(p.stock, 0) <> coalesce(sum(s.value::int), 0);

-- Planned variant_sku duplicates.
-- Sizes like "M/L", "M L", and "M-L" can normalize to the same suffix.
with safe_products as (
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
    s.key as size
  from safe_products p
  cross join lateral jsonb_each_text(p.safe_size_stock) s(key, value)
  where s.value ~ '^-?[0-9]+$'
),
one_size_products as (
  select
    p.id as product_id,
    p.sku as product_sku,
    'ONE SIZE'::text as size
  from safe_products p
  where not exists (
    select 1
    from valid_size_rows r
    where r.product_id = p.id
  )
),
planned_variants as (
  select
    product_id,
    product_sku,
    size,
    product_sku || '-' || upper(regexp_replace(size, '[^a-zA-Z0-9]+', '-', 'g')) as planned_variant_sku
  from valid_size_rows
  union all
  select
    product_id,
    product_sku,
    size,
    product_sku as planned_variant_sku
  from one_size_products
)
select
  planned_variant_sku,
  count(*) as duplicate_count,
  jsonb_agg(
    jsonb_build_object(
      'product_id', product_id,
      'product_sku', product_sku,
      'size', size
    )
    order by product_sku, size
  ) as affected_variants
from planned_variants
group by planned_variant_sku
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- Data migration
-- Run only after pre-migration checks are clean or reviewed.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Post-migration reconciliation
-- ---------------------------------------------------------------------------

-- Products without variants
select p.id, p.sku
from public.products p
left join public.product_variants v on v.product_id = p.id
where p.sku is not null
  and btrim(p.sku) <> ''
  and v.id is null;

-- products.stock vs inventory balance total
select
  p.id,
  p.sku,
  coalesce(p.stock, 0) as old_product_stock,
  coalesce(sum(b.quantity_on_hand), 0) as new_inventory_stock,
  coalesce(p.stock, 0) - coalesce(sum(b.quantity_on_hand), 0) as difference
from public.products p
left join public.product_variants v on v.product_id = p.id
left join public.inventory_balances b on b.variant_id = v.id
group by p.id, p.sku, p.stock
having coalesce(p.stock, 0) <> coalesce(sum(b.quantity_on_hand), 0);

-- size_stock vs variant balance
select
  p.sku,
  s.key as old_size,
  s.value::int as old_quantity,
  coalesce(b.quantity_on_hand, 0) as new_quantity
from public.products p
cross join lateral jsonb_each_text(
  case
    when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
    then p.size_stock
    else '{}'::jsonb
  end
) s(key, value)
left join public.product_variants v
  on v.product_id = p.id
 and v.size = s.key
left join public.inventory_balances b
  on b.variant_id = v.id
where s.value ~ '^-?[0-9]+$'
  and s.value::int <> coalesce(b.quantity_on_hand, 0);

-- Duplicate variant_sku
select variant_sku, count(*)
from public.product_variants
group by variant_sku
having count(*) > 1;

-- Duplicate variant barcode
select barcode, count(*)
from public.product_variants
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;

-- Missing initial migration movements
select
  v.variant_sku,
  b.quantity_on_hand,
  count(m.id) as initial_movement_count
from public.product_variants v
join public.inventory_balances b on b.variant_id = v.id
left join public.stock_movements m
  on m.variant_id = v.id
 and m.location_id = b.location_id
 and m.movement_type = 'initial_migration'
group by v.variant_sku, b.quantity_on_hand
having count(m.id) = 0;

-- Reserved quantity should never exceed on-hand quantity.
select *
from public.inventory_balances
where quantity_reserved > quantity_on_hand;

-- ---------------------------------------------------------------------------
-- Permanent delete risk after ERP Phase 1
-- ---------------------------------------------------------------------------
-- product_variants.product_id references products(id) on delete cascade.
-- stock_movements.variant_id references product_variants(id) on delete restrict.
-- This migration creates an initial_migration stock movement for every variant.
--
-- Result:
-- Existing DELETE /api/admin/products/[id]/permanent may fail after migration
-- because deleting a product cascades to variants, but stock_movements prevents
-- deleting variants that already have inventory history.
--
-- Recommendation:
-- - ERP/POS mode should treat real products as soft-delete / inactive only.
-- - Permanent delete should only be allowed for test products that have no
--   stock_movements.
-- - A later code change should update
--   DELETE /api/admin/products/[id]/permanent to return a friendly message,
--   for example:
--   "This product has inventory history and cannot be permanently deleted.
--    Please deactivate it instead."

-- ---------------------------------------------------------------------------
-- Rollback draft
-- Only valid while:
-- - USE_VARIANT_INVENTORY=false
-- - no real business writes have been made to stock_movements
--
-- drop table if exists public.stock_movements cascade;
-- drop table if exists public.inventory_balances cascade;
-- drop table if exists public.product_variants cascade;
-- drop table if exists public.inventory_locations cascade;
-- drop table if exists public.audit_logs cascade;
-- ---------------------------------------------------------------------------
