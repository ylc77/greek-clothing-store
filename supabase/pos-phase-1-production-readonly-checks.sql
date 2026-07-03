-- POS Phase 1 production read-only checks
-- This file is read-only. Only SELECT statements are allowed.

-- 1. products.id should be bigint.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name = 'id'
  and data_type <> 'bigint';

-- 2. product_variants.id should exist.
select 'missing public.product_variants.id' as issue
where not exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_variants'
    and column_name = 'id'
);

-- 3. product_variants.product_id should be bigint.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'product_variants'
  and column_name = 'product_id'
  and data_type <> 'bigint';

-- 4. inventory_balances should exist.
select 'missing public.inventory_balances' as issue
where to_regclass('public.inventory_balances') is null;

-- 5. stock_movements should exist.
select 'missing public.stock_movements' as issue
where to_regclass('public.stock_movements') is null;

-- 6. POS tables should not already exist before first POS migration.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('sales_orders', 'sales_order_items', 'payments');

-- 7. product_variants should not have duplicate barcode values.
select barcode, count(*) as duplicate_count
from public.product_variants
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;

-- 8. product_variants should not have duplicate variant_sku values.
select variant_sku, count(*) as duplicate_count
from public.product_variants
where variant_sku is not null and btrim(variant_sku) <> ''
group by variant_sku
having count(*) > 1;

-- 9. inventory_balances should not contain negative stock.
select id, variant_id, location_id, quantity_on_hand, quantity_reserved
from public.inventory_balances
where quantity_on_hand < 0
   or quantity_reserved < 0;

-- 10. ERP reconciliation should still be clean.
with
erp_totals as (
  select
    pv.product_id,
    coalesce(sum(ib.quantity_on_hand) filter (where pv.active), 0)::int as erp_stock
  from public.product_variants pv
  left join public.inventory_balances ib on ib.variant_id = pv.id
  group by pv.product_id
),
legacy_size_totals as (
  select
    p.id as product_id,
    coalesce(sum(size_entry.value::int), 0)::int as size_stock_total
  from public.products p
  cross join lateral jsonb_each_text(
    case
      when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
      then p.size_stock
      else '{}'::jsonb
    end
  ) size_entry(key, value)
  where size_entry.value ~ '^-?[0-9]+$'
  group by p.id
),
stock_mismatches as (
  select p.id, p.sku, coalesce(p.stock, 0)::int as legacy_stock, coalesce(et.erp_stock, 0)::int as erp_stock
  from public.products p
  left join erp_totals et on et.product_id = p.id
  where coalesce(p.stock, 0)::int <> coalesce(et.erp_stock, 0)::int
),
size_stock_mismatches as (
  select p.id, p.sku, coalesce(lst.size_stock_total, 0)::int as size_stock_total, coalesce(et.erp_stock, 0)::int as erp_stock
  from public.products p
  left join legacy_size_totals lst on lst.product_id = p.id
  left join erp_totals et on et.product_id = p.id
  where p.size_stock is not null
    and jsonb_typeof(p.size_stock) = 'object'
    and jsonb_object_length(p.size_stock) > 0
    and coalesce(lst.size_stock_total, 0)::int <> coalesce(et.erp_stock, 0)::int
),
products_without_variants as (
  select p.id, p.sku
  from public.products p
  where not exists (
    select 1 from public.product_variants pv where pv.product_id = p.id
  )
),
variants_without_balance as (
  select pv.id, pv.variant_sku
  from public.product_variants pv
  where not exists (
    select 1 from public.inventory_balances ib where ib.variant_id = pv.id
  )
),
duplicate_variant_skus as (
  select variant_sku, count(*) as duplicate_count
  from public.product_variants
  where variant_sku is not null and btrim(variant_sku) <> ''
  group by variant_sku
  having count(*) > 1
),
duplicate_barcodes as (
  select barcode, count(*) as duplicate_count
  from public.product_variants
  where barcode is not null and btrim(barcode) <> ''
  group by barcode
  having count(*) > 1
),
reserved_issues as (
  select id, variant_id, quantity_on_hand, quantity_reserved
  from public.inventory_balances
  where quantity_reserved > quantity_on_hand
),
blank_reasons as (
  select id, movement_type, reason
  from public.stock_movements
  where reason is null or btrim(reason) = ''
),
issue_counts as (
  select 'products.stock vs ERP balance mismatch' as check_name, count(*) as issue_count from stock_mismatches
  union all
  select 'size_stock vs ERP balance mismatch', count(*) from size_stock_mismatches
  union all
  select 'products without variants', count(*) from products_without_variants
  union all
  select 'variants without balance', count(*) from variants_without_balance
  union all
  select 'duplicate variant_sku', count(*) from duplicate_variant_skus
  union all
  select 'duplicate barcode', count(*) from duplicate_barcodes
  union all
  select 'quantity_reserved greater than quantity_on_hand', count(*) from reserved_issues
  union all
  select 'stock_movements reason blank', count(*) from blank_reasons
)
select check_name, issue_count
from issue_counts
where issue_count > 0;
