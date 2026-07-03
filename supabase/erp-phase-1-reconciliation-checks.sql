-- ERP Phase 1 reconciliation checks.
-- Read-only file. Only SELECT statements are allowed.

-- 1. products.stock vs inventory_balances total.
-- Expected: 0 rows.
select
  p.id,
  p.sku,
  p.stock as legacy_stock,
  coalesce(sum(b.quantity_on_hand), 0) as erp_stock
from public.products p
left join public.product_variants v on v.product_id = p.id
left join public.inventory_balances b on b.variant_id = v.id
group by p.id, p.sku, p.stock
having p.stock <> coalesce(sum(b.quantity_on_hand), 0);

-- 2. products.size_stock vs variant/balance by size.
-- Expected: 0 rows.
with size_targets as (
  select
    p.id as product_id,
    p.sku,
    upper(kv.key) as size,
    greatest(0, trunc((kv.value)::numeric))::int as target_quantity
  from public.products p
  cross join lateral jsonb_each_text(
    case
      when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
      then p.size_stock
      else '{}'::jsonb
    end
  ) kv
),
erp_sizes as (
  select
    v.product_id,
    v.size,
    sum(b.quantity_on_hand)::int as erp_quantity
  from public.product_variants v
  left join public.inventory_balances b on b.variant_id = v.id
  group by v.product_id, v.size
)
select
  t.product_id,
  t.sku,
  t.size,
  t.target_quantity,
  coalesce(e.erp_quantity, 0) as erp_quantity
from size_targets t
left join erp_sizes e
  on e.product_id = t.product_id
 and upper(e.size) = t.size
where t.target_quantity <> coalesce(e.erp_quantity, 0);

-- 3. Products missing variants.
-- Expected: 0 rows.
select
  p.id,
  p.sku
from public.products p
left join public.product_variants v on v.product_id = p.id
where v.id is null;

-- 4. Variants missing MAIN_STORE balance.
-- Expected: 0 rows.
select
  v.id as variant_id,
  v.variant_sku,
  v.product_id
from public.product_variants v
cross join (
  select id
  from public.inventory_locations
  where code = 'MAIN_STORE'
  limit 1
) main_store
left join public.inventory_balances b
  on b.variant_id = v.id
 and b.location_id = main_store.id
where b.id is null;

-- 5. Duplicate variant_sku.
-- Expected: 0 rows.
select
  variant_sku,
  count(*) as duplicate_count
from public.product_variants
group by variant_sku
having count(*) > 1;

-- 6. Duplicate barcode. Must be grouped by barcode, not by id.
-- Expected: 0 rows.
select
  barcode,
  count(*) as duplicate_count
from public.product_variants
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;

-- 7. Reserved quantity exceeds on-hand quantity.
-- Expected: 0 rows.
select
  id,
  variant_id,
  location_id,
  quantity_reserved,
  quantity_on_hand
from public.inventory_balances
where quantity_reserved > quantity_on_hand
   or quantity_reserved < 0
   or quantity_on_hand < 0;

-- 8. Stock movements missing reason or using blank reason.
-- Expected: 0 rows.
select
  id,
  variant_id,
  movement_type,
  reason
from public.stock_movements
where reason is null or btrim(reason) = '';
