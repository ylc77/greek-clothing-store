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

-- 11. Public POS RPC entry functions and private helpers should exist.
with expected_functions(schema_name, function_name, args) as (
  values
    ('public', 'pos_checkout_rpc', 'p_client_request_id text, p_payment_method text, p_items jsonb, p_discount_total numeric, p_notes text, p_created_by text'),
    ('public', 'pos_void_rpc', 'p_order_id uuid, p_client_request_id text, p_reason text, p_created_by text'),
    ('app_private', 'pos_order_payload', 'p_order_id uuid, p_already_processed boolean'),
    ('app_private', 'pos_sync_legacy_stock_from_erp', 'p_product_id bigint')
),
missing_functions as (
  select e.schema_name, e.function_name
  from expected_functions e
  left join pg_namespace n on n.nspname = e.schema_name
  left join pg_proc p
    on p.pronamespace = n.oid
   and p.proname = e.function_name
   and pg_get_function_identity_arguments(p.oid) = e.args
  where p.oid is null
)
select 'missing POS RPC function' as check_name, count(*) as issue_count
from missing_functions
having count(*) > 0;

-- 12. Old app_private POS RPC entry functions should not remain.
with old_private_entries as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private'
    and p.proname in ('pos_checkout_rpc', 'pos_void_rpc')
)
select 'old app_private POS RPC entry still exists' as check_name, count(*) as issue_count
from old_private_entries
having count(*) > 0;

-- 13. Browser roles should not be able to execute POS RPC functions.
with exposed_role_access as (
  select r.role_name, n.nspname as schema_name, p.proname as function_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  where ((
      n.nspname = 'public'
      and p.proname in ('pos_checkout_rpc', 'pos_void_rpc')
    )
    or (
      n.nspname = 'app_private'
      and p.proname in ('pos_order_payload', 'pos_sync_legacy_stock_from_erp')
    ))
    and has_function_privilege(r.role_name, p.oid, 'EXECUTE')
)
select 'browser role can execute POS RPC function' as check_name, count(*) as issue_count
from exposed_role_access
having count(*) > 0;

-- 14. service_role should be able to execute public POS RPC entry functions.
with service_role_missing_access as (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('pos_checkout_rpc', 'pos_void_rpc')
    and not has_function_privilege('service_role', p.oid, 'EXECUTE')
)
select 'service_role cannot execute public POS RPC entry' as check_name, count(*) as issue_count
from service_role_missing_access
having count(*) > 0;

-- 15. app_private should not be exposed to browser roles.
with browser_schema_access as (
  select role_name
  from (values ('anon'), ('authenticated')) as r(role_name)
  where has_schema_privilege(role_name, 'app_private', 'USAGE')
)
select 'browser role can use app_private schema' as check_name, count(*) as issue_count
from browser_schema_access
having count(*) > 0;
