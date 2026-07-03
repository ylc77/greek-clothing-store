-- POS Phase 1-E production read-only checks.
-- This file is read-only. Only SELECT / WITH SELECT statements are allowed.

-- 1. Required POS and ERP tables should exist.
with required_tables(table_name) as (
  values
    ('sales_orders'),
    ('sales_order_items'),
    ('payments'),
    ('products'),
    ('product_variants'),
    ('inventory_balances'),
    ('stock_movements')
),
missing_tables as (
  select rt.table_name
  from required_tables rt
  left join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = rt.table_name
  where t.table_name is null
)
select 'missing required table' as check_name, count(*) as issue_count
from missing_tables
having count(*) > 0;

-- 2. products.id should be bigint.
select 'products.id is not bigint' as check_name, count(*) as issue_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name = 'id'
  and data_type <> 'bigint';

-- 3. sales_order_items.product_id should be bigint.
select 'sales_order_items.product_id is not bigint' as check_name, count(*) as issue_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'sales_order_items'
  and column_name = 'product_id'
  and data_type <> 'bigint';

-- 4. ERP reconciliation should return 0 issues.
with legacy_size_totals as (
  select
    p.id as product_id,
    coalesce(sum(greatest(0, trunc((kv.value)::numeric))::int), 0) as size_stock_total
  from public.products p
  left join lateral jsonb_each_text(
    case
      when p.size_stock is not null and jsonb_typeof(p.size_stock) = 'object'
      then p.size_stock
      else '{}'::jsonb
    end
  ) kv on true
  group by p.id
),
erp_totals as (
  select
    v.product_id,
    coalesce(sum(b.quantity_on_hand), 0)::int as erp_stock
  from public.product_variants v
  left join public.inventory_balances b on b.variant_id = v.id
  group by v.product_id
),
stock_mismatches as (
  select p.id
  from public.products p
  left join erp_totals et on et.product_id = p.id
  where p.stock <> coalesce(et.erp_stock, 0)
),
size_stock_mismatches as (
  select p.id
  from public.products p
  left join legacy_size_totals lst on lst.product_id = p.id
  left join erp_totals et on et.product_id = p.id
  where p.size_stock is not null
    and jsonb_typeof(p.size_stock) = 'object'
    and exists (select 1 from jsonb_each_text(p.size_stock))
    and coalesce(lst.size_stock_total, 0)::int <> coalesce(et.erp_stock, 0)::int
),
products_without_variants as (
  select p.id
  from public.products p
  where not exists (
    select 1
    from public.product_variants pv
    where pv.product_id = p.id
  )
),
variants_without_balance as (
  select pv.id
  from public.product_variants pv
  where not exists (
    select 1
    from public.inventory_balances ib
    where ib.variant_id = pv.id
  )
),
duplicate_variant_skus as (
  select variant_sku
  from public.product_variants
  group by variant_sku
  having count(*) > 1
),
duplicate_barcodes as (
  select barcode
  from public.product_variants
  where barcode is not null and btrim(barcode) <> ''
  group by barcode
  having count(*) > 1
),
reserved_issues as (
  select id
  from public.inventory_balances
  where quantity_reserved > quantity_on_hand
     or quantity_reserved < 0
     or quantity_on_hand < 0
),
blank_reasons as (
  select id
  from public.stock_movements
  where reason is null or btrim(reason) = ''
),
issue_counts as (
  select count(*) as issue_count from stock_mismatches
  union all select count(*) from size_stock_mismatches
  union all select count(*) from products_without_variants
  union all select count(*) from variants_without_balance
  union all select count(*) from duplicate_variant_skus
  union all select count(*) from duplicate_barcodes
  union all select count(*) from reserved_issues
  union all select count(*) from blank_reasons
)
select 'ERP reconciliation issue' as check_name, sum(issue_count)::int as issue_count
from issue_counts
having sum(issue_count) > 0;

-- 5. POS orders should not be stuck in unexpected states.
select 'unexpected POS order status' as check_name, count(*) as issue_count
from public.sales_orders
where status not in ('completed', 'voided', 'refunded')
   or payment_status not in ('paid', 'voided', 'refunded')
having count(*) > 0;

-- 6. Completed POS orders should have sale / pos_sale movements.
with completed_orders_without_sale as (
  select o.id
  from public.sales_orders o
  where o.source = 'pos'
    and o.status = 'completed'
    and not exists (
      select 1
      from public.stock_movements sm
      where sm.source_id = o.id::text
        and sm.source_type = 'pos_sale'
        and sm.movement_type = 'sale'
    )
)
select 'completed POS order without sale movement' as check_name, count(*) as issue_count
from completed_orders_without_sale
having count(*) > 0;

-- 7. Voided POS orders should have pos_void movements.
with voided_orders_without_void_movement as (
  select o.id
  from public.sales_orders o
  where o.source = 'pos'
    and o.status = 'voided'
    and not exists (
      select 1
      from public.stock_movements sm
      where sm.source_id = o.id::text
        and sm.source_type = 'pos_void'
        and sm.movement_type = 'return'
    )
)
select 'voided POS order without void movement' as check_name, count(*) as issue_count
from voided_orders_without_void_movement
having count(*) > 0;

-- 8. inventory_balances should not have negative stock.
select 'negative inventory balance' as check_name, count(*) as issue_count
from public.inventory_balances
where quantity_on_hand < 0
   or quantity_reserved < 0
   or quantity_reserved > quantity_on_hand
having count(*) > 0;

-- 9. sales_orders idempotency keys should not be duplicated.
with duplicate_order_keys as (
  select idempotency_key
  from public.sales_orders
  where idempotency_key is not null and btrim(idempotency_key) <> ''
  group by idempotency_key
  having count(*) > 1
)
select 'duplicate sales_orders idempotency_key' as check_name, count(*) as issue_count
from duplicate_order_keys
having count(*) > 0;

-- 10. stock_movements idempotency keys should not be duplicated.
with duplicate_movement_keys as (
  select idempotency_key
  from public.stock_movements
  where idempotency_key is not null and btrim(idempotency_key) <> ''
  group by idempotency_key
  having count(*) > 1
)
select 'duplicate stock_movements idempotency_key' as check_name, count(*) as issue_count
from duplicate_movement_keys
having count(*) > 0;
