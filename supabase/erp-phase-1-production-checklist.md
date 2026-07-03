# ERP Phase 1 Production Migration Checklist

Status: production preparation only. Do not run production migration until every
item below is confirmed.

## Before Production Execution

- [ ] Production 10 read-only checks all passed.
- [ ] Database backup is confirmed and restorable.
- [ ] `supabase/migrations/20260703_add_erp_inventory_phase_1.sql` has been verified in the test database.
- [ ] No one will add, edit, delete, upload images, or quick-sell products during execution.
- [ ] `USE_VARIANT_INVENTORY=false`.
- [ ] Permanent delete risk is accepted:
  - real products should be deactivated / soft-deleted after ERP begins;
  - permanent delete should only be used for test products with no inventory history;
  - the permanent delete API should later return a friendly message when stock movements exist.
- [ ] The production migration operator has confirmed this is not the test project.
- [ ] The service role key remains server-only and is not exposed to browser code, client components, or `NEXT_PUBLIC_*` variables.

## After Production Execution

Record these counts:

```sql
select 'products' as item, count(*)::int as count from public.products
union all select 'product_variants', count(*)::int from public.product_variants
union all select 'inventory_balances', count(*)::int from public.inventory_balances
union all select 'stock_movements', count(*)::int from public.stock_movements
union all select 'inventory_locations', count(*)::int from public.inventory_locations
order by item;
```

All reconciliation checks must return `0`:

```sql
select p.id, p.sku
from public.products p
left join public.product_variants v on v.product_id = p.id
where p.sku is not null
  and btrim(p.sku) <> ''
  and v.id is null;
```

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

```sql
select variant_sku, count(*)
from public.product_variants
group by variant_sku
having count(*) > 1;
```

```sql
select barcode, count(*)
from public.product_variants
where barcode is not null and btrim(barcode) <> ''
group by barcode
having count(*) > 1;
```

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

```sql
select *
from public.inventory_balances
where quantity_reserved > quantity_on_hand;
```

```sql
select idempotency_key, count(*)
from public.stock_movements
where idempotency_key is not null
group by idempotency_key
having count(*) > 1;
```

## Idempotency Verification

- [ ] Re-run only the data migration CTE from the migration file in a controlled window.
- [ ] Confirm `product_variants` count does not increase.
- [ ] Confirm `inventory_balances` count does not increase.
- [ ] Confirm `stock_movements` count does not increase.
- [ ] Confirm duplicate `idempotency_key` check returns 0 rows.

## RLS Verification

- [ ] `anon` cannot read `product_variants`.
- [ ] `anon` cannot read `inventory_balances`.
- [ ] `anon` cannot read `stock_movements`.
- [ ] `anon` cannot read `audit_logs`.
- [ ] `authenticated` cannot read the ERP tables above.
- [ ] `service_role` can read/write ERP tables from server-side code.

## Manual Page Verification

- [ ] Homepage opens normally.
- [ ] Category page opens normally.
- [ ] Product detail page opens normally.
- [ ] Admin dashboard opens normally.
- [ ] Product edit still works with old fields.
- [ ] `/feed.xml` opens normally.
- [ ] `/sitemap.xml` opens normally.

## Final Decision

- [ ] If all checks pass, ERP Phase 1 schema can remain in production with `USE_VARIANT_INVENTORY=false`.
- [ ] If any check fails, stop and investigate before implementing backend dual-write.
