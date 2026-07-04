-- POS runtime health checks.
-- This file is read-only. Only SELECT statements are allowed.
-- Expected result for each check: 0 rows.

-- 1. Completed orders without payment.
select
  so.id,
  so.order_number,
  so.status,
  so.payment_status,
  so.created_at
from public.sales_orders so
where so.status = 'completed'
  and not exists (
    select 1
    from public.payments p
    where p.order_id = so.id
  );

-- 2. Completed orders without sales order items.
select
  so.id,
  so.order_number,
  so.status,
  so.created_at
from public.sales_orders so
where so.status = 'completed'
  and not exists (
    select 1
    from public.sales_order_items soi
    where soi.order_id = so.id
  );

-- 3. Completed orders without sale / pos_sale stock movement.
select
  so.id,
  so.order_number,
  so.status,
  so.created_at
from public.sales_orders so
where so.status = 'completed'
  and not exists (
    select 1
    from public.stock_movements sm
    where sm.source_id = so.id::text
      and sm.movement_type = 'sale'
      and sm.source_type = 'pos_sale'
  );

-- 4. Voided orders without return / pos_void stock movement.
select
  so.id,
  so.order_number,
  so.status,
  so.voided_at
from public.sales_orders so
where so.status = 'voided'
  and not exists (
    select 1
    from public.stock_movements sm
    where sm.source_id = so.id::text
      and sm.movement_type = 'return'
      and sm.source_type = 'pos_void'
  );

-- 5. Payment status and order payment_status mismatch.
select
  so.id,
  so.order_number,
  so.payment_status as order_payment_status,
  p.id as payment_id,
  p.status as payment_status,
  so.created_at
from public.sales_orders so
join public.payments p on p.order_id = so.id
where so.payment_status <> p.status;

-- 6. Sales order items with quantity <= 0.
select
  soi.id,
  soi.order_id,
  soi.variant_sku,
  soi.quantity,
  soi.created_at
from public.sales_order_items soi
where soi.quantity <= 0;

-- 7. Sales order total and item totals mismatch.
select
  so.id,
  so.order_number,
  so.total as order_total,
  coalesce(sum(soi.line_total), 0) as items_total,
  so.discount_total,
  so.created_at
from public.sales_orders so
left join public.sales_order_items soi on soi.order_id = so.id
group by so.id, so.order_number, so.total, so.discount_total, so.created_at
having so.total <> greatest(0, coalesce(sum(soi.line_total), 0) - so.discount_total);

-- 8. Negative inventory balances.
select
  ib.id,
  ib.variant_id,
  pv.variant_sku,
  ib.quantity_on_hand,
  ib.quantity_reserved,
  ib.updated_at
from public.inventory_balances ib
left join public.product_variants pv on pv.id = ib.variant_id
where ib.quantity_on_hand < 0
   or ib.quantity_reserved < 0;

-- 9. ERP stock total and products.stock mismatch.
select
  p.id,
  p.sku,
  p.stock as legacy_stock,
  coalesce(sum(ib.quantity_on_hand), 0) as erp_stock
from public.products p
left join public.product_variants pv on pv.product_id = p.id
left join public.inventory_balances ib on ib.variant_id = pv.id
group by p.id, p.sku, p.stock
having p.stock <> coalesce(sum(ib.quantity_on_hand), 0);

-- 10. Stock movements with blank reason.
select
  sm.id,
  sm.variant_id,
  sm.movement_type,
  sm.source_type,
  sm.source_id,
  sm.reason,
  sm.created_at
from public.stock_movements sm
where sm.reason is null
   or btrim(sm.reason) = '';

-- 11. Duplicate sales_orders idempotency_key.
select
  so.idempotency_key,
  count(*) as duplicate_count
from public.sales_orders so
where so.idempotency_key is not null
  and btrim(so.idempotency_key) <> ''
group by so.idempotency_key
having count(*) > 1;

-- 12. Duplicate stock_movements idempotency_key.
select
  sm.idempotency_key,
  count(*) as duplicate_count
from public.stock_movements sm
where sm.idempotency_key is not null
  and btrim(sm.idempotency_key) <> ''
group by sm.idempotency_key
having count(*) > 1;

-- 13. Voided orders still marked as paid.
select
  so.id,
  so.order_number,
  so.status,
  so.payment_status,
  so.voided_at
from public.sales_orders so
where so.status = 'voided'
  and so.payment_status = 'paid';
