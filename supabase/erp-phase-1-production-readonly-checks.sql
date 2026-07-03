-- ERP Phase 1 production read-only checks
-- This file is read-only. Only SELECT statements are allowed.
--
-- Do not run create / insert / update / delete / drop / alter from this file.
-- Do not execute the ERP migration on production until these checks are clean
-- and the test database migration has passed.

-- 1. Empty SKU
select id, sku
from public.products
where sku is null or btrim(sku) = '';

-- 2. Duplicate SKU
select sku, count(*)
from public.products
where sku is not null and btrim(sku) <> ''
group by sku
having count(*) > 1;

-- 3. Duplicate barcode
select barcode, count(*)
from public.products
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;

-- 4. Duplicate ean
select ean, count(*)
from public.products
where ean is not null and btrim(ean) <> ''
group by ean
having count(*) > 1;

-- 5. size_stock is not an object
select id, sku, size_stock
from public.products
where size_stock is not null
  and jsonb_typeof(size_stock) <> 'object';

-- 6. size_stock quantity is not an integer
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

-- 7. size_stock contains negative quantity
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

-- 8. products.stock is negative
select id, sku, stock
from public.products
where coalesce(stock, 0) < 0;

-- 9. products.stock does not match size_stock total
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

-- 10. Planned variant_sku duplicates
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

