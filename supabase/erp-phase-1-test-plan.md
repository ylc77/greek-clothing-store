# ERP Phase 1 Test Execution Plan

Status: planning only. Do not execute this plan against production until the
test database has passed all checks.

This plan is for validating `supabase/erp-phase-1-migration-draft.sql` in a
test Supabase project or local test database.

Do not:

- Execute the migration on production.
- Change business code.
- Change storefront or admin pages.
- Switch `USE_VARIANT_INVENTORY`.
- Move the draft SQL into `supabase/migrations` yet.

## 1. Production Read-Only Prechecks

Production prechecks must be `SELECT` only.

Do not run:

- `create`
- `insert`
- `update`
- `delete`
- `drop`
- `alter`

If any check returns rows, record the result and fix the issue first in a test
database. Do not modify production during this read-only step.

### Empty SKU

```sql
select id, sku
from public.products
where sku is null or btrim(sku) = '';
```

Expected result: 0 rows.

If rows are returned, those products cannot be safely migrated. Add SKUs before
production migration.

### Duplicate SKU

```sql
select sku, count(*)
from public.products
where sku is not null and btrim(sku) <> ''
group by sku
having count(*) > 1;
```

Expected result: 0 rows.

If rows are returned, manually decide which product is real and rename or
deactivate duplicates.

### Duplicate Barcode

```sql
select barcode, count(*)
from public.products
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;
```

Expected result: 0 rows.

If rows are returned, clear or correct duplicate barcodes before POS work.

### Duplicate EAN

```sql
select ean, count(*)
from public.products
where ean is not null and btrim(ean) <> ''
group by ean
having count(*) > 1;
```

Expected result: 0 rows.

If rows are returned, clear or correct duplicate EAN values.

### Invalid `size_stock` Type

```sql
select id, sku, size_stock
from public.products
where size_stock is not null
  and jsonb_typeof(size_stock) <> 'object';
```

Expected result: 0 rows.

If rows are returned, convert `size_stock` to a JSON object such as `{}` or
`{"S": 1, "M": 2}`.

### Non-Integer `size_stock` Quantity

```sql
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
```

Expected result: 0 rows.

If rows are returned, change quantities to integers.

### Negative Product Stock

```sql
select id, sku, stock
from public.products
where coalesce(stock, 0) < 0;
```

Expected result: 0 rows.

If rows are returned, correct stock to 0 or the real quantity.

### Negative `size_stock`

```sql
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
```

Expected result: 0 rows.

If rows are returned, correct size quantities to 0 or the real quantity.

### `products.stock` Does Not Match `size_stock` Total

```sql
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
```

Expected result: 0 rows.

If rows are returned, decide which source is correct. Recommended rule: if
`size_stock` exists, treat the sum of `size_stock` as the real stock.

### Planned Variant SKU Duplicates

```sql
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
```

Expected result: 0 rows.

If rows are returned, normalize size names, rename SKUs, or adjust the planned
variant SKU rule before migration.

## 2. Test Database Execution Steps

Recommended order:

1. Prepare a test Supabase project or local test database.
2. Import data close to production.
3. Run all read-only prechecks.
4. Run the table creation SQL.
5. Run the data migration SQL.
6. Run post-migration reconciliation SQL.
7. Run idempotency tests.
8. Run RLS verification.
9. Manually open old storefront/admin pages.

### Table Creation SQL

Run the first schema section from `supabase/erp-phase-1-migration-draft.sql`:

```txt
from:
create extension if not exists pgcrypto;

to:
alter table public.audit_logs enable row level security;
```

Then verify tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'product_variants',
    'inventory_locations',
    'inventory_balances',
    'stock_movements',
    'audit_logs'
  );
```

Expected result: 5 rows.

### Data Migration SQL

Run the `Data migration` section from
`supabase/erp-phase-1-migration-draft.sql`:

```txt
from:
with main_location as (...)

to:
on conflict (idempotency_key) do nothing;
```

Record counts after execution:

```sql
select count(*) as product_variants_count from public.product_variants;
select count(*) as inventory_balances_count from public.inventory_balances;
select count(*) as stock_movements_count from public.stock_movements;
select count(*) as inventory_locations_count from public.inventory_locations;
```

### Post-Migration Reconciliation SQL

Products without variants:

```sql
select p.id, p.sku
from public.products p
left join public.product_variants v on v.product_id = p.id
where p.sku is not null
  and btrim(p.sku) <> ''
  and v.id is null;
```

Expected result: 0 rows.

`products.stock` vs inventory balance total:

```sql
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
```

Expected result: 0 rows.

`size_stock` vs variant balance:

```sql
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
```

Expected result: 0 rows.

Duplicate variant SKU:

```sql
select variant_sku, count(*)
from public.product_variants
group by variant_sku
having count(*) > 1;
```

Expected result: 0 rows.

Duplicate variant barcode:

```sql
select barcode, count(*)
from public.product_variants
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;
```

Expected result: 0 rows.

Missing initial migration movements:

```sql
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
```

Expected result: 0 rows.

Reserved quantity exceeds on-hand quantity:

```sql
select *
from public.inventory_balances
where quantity_reserved > quantity_on_hand;
```

Expected result: 0 rows.

### Rollback SQL

Use only in a test database, or before ERP is enabled and before any real
business writes are made to `stock_movements`.

```sql
drop table if exists public.stock_movements cascade;
drop table if exists public.inventory_balances cascade;
drop table if exists public.product_variants cascade;
drop table if exists public.inventory_locations cascade;
drop table if exists public.audit_logs cascade;
```

## 3. Idempotency Test

After the first data migration run, record:

```sql
select count(*) from public.product_variants;
select count(*) from public.inventory_balances;
select count(*) from public.stock_movements;

select movement_type, count(*)
from public.stock_movements
group by movement_type
order by movement_type;
```

Run the same `Data migration SQL` section a second time.

Record the same counts again:

```sql
select count(*) from public.product_variants;
select count(*) from public.inventory_balances;
select count(*) from public.stock_movements;

select movement_type, count(*)
from public.stock_movements
group by movement_type
order by movement_type;
```

Expected result:

- `product_variants` count does not increase.
- `inventory_balances` count does not increase.
- `stock_movements` count does not increase.
- `initial_migration` does not duplicate.
- `inventory_balances.quantity_on_hand` does not change unexpectedly.

Duplicate idempotency key check:

```sql
select idempotency_key, count(*)
from public.stock_movements
where idempotency_key is not null
group by idempotency_key
having count(*) > 1;
```

Expected result: 0 rows.

## 4. RLS Verification

Expected access model:

- `anon` should not read the new ERP tables.
- `authenticated` should not read the new ERP tables.
- `service_role` should read and write the new ERP tables.
- The old storefront should continue reading `products`.

Important security rule:

```txt
The service_role key must only be used on the server. It must never be exposed
to the browser, client components, or any NEXT_PUBLIC environment variable.
```

Test with anon key:

```txt
Try reading:
- product_variants
- inventory_balances
- stock_movements
- audit_logs
```

Expected result:

```txt
No public rows are readable, or access is denied.
```

Test with a normal authenticated user:

```txt
The same ERP tables should not expose rows.
```

Test with service role:

```txt
Select, insert, and update should work from server-side code or SQL tools.
```

Old storefront check:

```txt
Homepage, category pages, product detail pages, and /feed.xml should still read
products normally.
```

## 5. Final Pass Criteria

These checks must return 0 rows:

- Empty SKU
- Duplicate SKU
- Invalid `size_stock`
- Non-integer `size_stock`
- Negative stock
- Planned variant SKU duplicates
- Products without variants
- Stock vs balance mismatches
- `size_stock` vs balance mismatches
- Duplicate variant SKU
- Duplicate variant barcode
- Missing initial migration movement
- `quantity_reserved > quantity_on_hand`
- Duplicate `idempotency_key`

These counts must be consistent:

- Every valid product has at least one variant.
- Every variant has a `MAIN_STORE` inventory balance.
- Balance stock total equals `products.stock`.
- `initial_migration` movement count equals inventory balance count.
- Re-running the data migration does not increase counts.

Manual pages to open:

- `/`
- `/men` or `/women`
- `/product/[sku]`
- `/admin`
- product edit page
- image upload area
- `/feed.xml`
- `/sitemap.xml`

Expected result:

- Pages open normally.
- Old product stock display still works.
- Admin product editing still works.
- Skroutz feed still uses old `products` fields.

## 6. Failure Handling

### Data Issues

- Empty SKU: add SKU.
- Duplicate SKU: merge, rename, or deactivate duplicates.
- Duplicate barcode/EAN: clear duplicate values or assign real unique codes.
- Invalid `size_stock`: convert to JSON object.
- Negative stock: set to 0 or real quantity.
- Stock mismatch: if `size_stock` exists, prefer the `size_stock` total.
- Planned variant SKU duplicate: normalize size labels or rename product SKU.

### Migration Failure

1. Stop immediately.
2. Save the error message.
3. Run rollback SQL in the test database.
4. Fix the draft migration.
5. Retry from a clean test database.

### Do Not Continue To Production If

- Production read-only prechecks have unresolved rows.
- Test schema creation fails.
- Test data migration fails.
- Idempotency test fails.
- Reconciliation returns mismatches.
- RLS verification fails.
- `anon` or `authenticated` can read ERP tables.
- Old storefront, admin, `/feed.xml`, or `/sitemap.xml` breaks.
- The permanent delete risk has not been accepted.
- There is no current production backup.

