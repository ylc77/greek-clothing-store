# POS Phase 1-E-A2 RPC Transaction Test Plan

This plan verifies the PostgreSQL RPC draft for POS checkout and POS void after moving the external RPC entry points to the public schema.

Do not run this plan directly on production first. Do not switch `USE_POS_RPC` during this phase.

## Scope

- Draft RPC migration only.
- No production writes during review.
- No business code changes.
- No checkout route changes.
- No void route changes.
- No UI changes.
- No invoice, myDATA, or printing.
- No changes to existing table structures.

## Files

- `supabase/pos-phase-1e-rpc-migration-draft.sql`
- `supabase/pos-phase-1e-production-readonly-checks.sql`
- `supabase/pos-phase-1e-test-plan.md`

## Safety Rules

- `service_role` key must only be used on the server.
- Never expose `service_role` through browser code, client components, or `NEXT_PUBLIC_*`.
- Frontend must not call the RPC functions directly.
- Next.js API routes must still validate `x-admin-password`.
- RPC execution should only be granted to `service_role`.
- `anon` and `authenticated` must not execute the RPC functions.

## Step 1: Production Read-Only Precheck

Run only:

```sql
supabase/pos-phase-1e-production-readonly-checks.sql
```

Expected:

- All result sets return no rows, or issue counts are 0.
- POS and ERP tables exist.
- `products.id` is bigint.
- `sales_order_items.product_id` is bigint.
- `public.pos_checkout_rpc` exists.
- `public.pos_void_rpc` exists.
- `app_private.pos_order_payload` exists.
- `app_private.pos_sync_legacy_stock_from_erp` exists.
- `anon` and `authenticated` cannot execute POS RPC functions.
- `service_role` can execute public POS RPC entry functions.
- ERP reconciliation has 0 issues.
- Completed POS orders have `sale / pos_sale` movements.
- Voided POS orders have `return / pos_void` movements.
- No negative inventory.
- No duplicate idempotency keys.

Stop if:

- Any ERP reconciliation issue appears.
- Any completed POS order lacks sale movement.
- Any voided POS order lacks void movement.
- Any negative inventory exists.
- Any required table is missing.

## Step 2: Prepare Test Supabase Project

Use the clothing store test Supabase project only.

Confirm:

- `products` has data.
- `product_variants` exists.
- `inventory_balances` exists.
- `stock_movements` exists.
- `sales_orders`, `sales_order_items`, and `payments` exist.
- ERP reconciliation is 0 before applying the RPC draft.

Do not use Wok Dragon or any other project.

## Step 3: Apply RPC Draft to Test Database

Run only in the test database:

```sql
supabase/pos-phase-1e-rpc-migration-draft.sql
```

Expected functions:

- `app_private.pos_sync_legacy_stock_from_erp(bigint)`
- `app_private.pos_order_payload(uuid, boolean)`
- `public.pos_checkout_rpc(text, text, jsonb, numeric, text, text)`
- `public.pos_void_rpc(uuid, text, text, text)`

Expected security:

- `app_private` schema exists.
- `public` contains only the external RPC entry points.
- `app_private` contains only internal helper functions.
- Functions are `SECURITY DEFINER`.
- `public.pos_checkout_rpc` is not executable by `anon`.
- `public.pos_checkout_rpc` is not executable by `authenticated`.
- `public.pos_void_rpc` is not executable by `anon`.
- `public.pos_void_rpc` is not executable by `authenticated`.
- `app_private` helper functions are not executable by `anon`.
- `app_private` helper functions are not executable by `authenticated`.
- `public.pos_checkout_rpc` is executable by `service_role`.
- `public.pos_void_rpc` is executable by `service_role`.
- `app_private` does not need to be added to exposed schemas.

## Step 4: Permission Verification

Verify:

- `anon` cannot execute `public.pos_checkout_rpc`.
- `authenticated` cannot execute `public.pos_checkout_rpc`.
- `anon` cannot execute `public.pos_void_rpc`.
- `authenticated` cannot execute `public.pos_void_rpc`.
- `anon` cannot execute app_private helper functions.
- `authenticated` cannot execute app_private helper functions.
- `service_role` can execute both public RPC entry functions.
- A service-role Supabase JS client can call:
  - `supabase.rpc("pos_checkout_rpc", ...)`
  - `supabase.rpc("pos_void_rpc", ...)`

Do not expose any RPC function to public browser clients. Do not add `app_private` to exposed schemas.

## Step 5: Checkout RPC Tests

Use a test SKU only.

### 5.1 Normal Checkout

Input:

- One active variant.
- Quantity 1.
- Payment method `cash`.
- Unique `client_request_id`.

Expected:

- A `sales_orders` row is created.
- `sales_order_items` rows are created.
- `payments` row is created.
- `inventory_balances.quantity_on_hand` decreases.
- `stock_movements` has `movement_type = sale`.
- `stock_movements` has `source_type = pos_sale`.
- `products.stock` and `products.size_stock` are synced.
- RPC returns order payload with `already_processed = false`.

### 5.2 Insufficient Stock

Input:

- Quantity greater than available stock.

Expected:

- RPC rejects the request.
- No order is created.
- No payment is created.
- No stock movement is written.
- No inventory balance changes.

### 5.3 Inactive Variant

Input:

- Inactive variant.

Expected:

- RPC rejects the request.
- No writes occur.

### 5.4 Duplicate Client Request ID

Input:

- Repeat the same `client_request_id` from a successful checkout.

Expected:

- RPC returns existing order.
- `already_processed = true`.
- No duplicate order.
- No duplicate payment.
- No duplicate stock movement.
- Inventory is not deducted again.

### 5.5 Multi-Item Checkout

Input:

- Multiple variants in one checkout.

Expected:

- One order.
- Multiple order items.
- Inventory updates for all variants.
- One stock movement per variant.
- Legacy product stock is synced for every affected product.

### 5.6 Same Variant Appears Multiple Times

Input:

- Same `variantId` appears in multiple item rows.

Expected:

- RPC aggregates quantity by variant.
- Only one order item / movement per variant is acceptable, or rows are consistent with aggregated quantity.
- Inventory is deducted once by the total requested quantity.

## Step 6: Void RPC Tests

Use an order created by `public.pos_checkout_rpc`.

### 6.1 Normal Void

Input:

- Valid `order_id`.
- Unique `client_request_id`.
- Reason with at least 3 characters.

Expected:

- `sales_orders.status = voided`.
- `sales_orders.payment_status = voided`.
- `sales_orders.voided_at` is set.
- `payments.status = voided`.
- Inventory is restored.
- `stock_movements` has `movement_type = return`.
- `stock_movements` has `source_type = pos_void`.
- `products.stock` and `products.size_stock` are synced.
- RPC returns `already_processed = false`.

### 6.2 Duplicate Void

Input:

- Run void again for the same order.

Expected:

- RPC returns `already_processed = true`.
- Inventory is not restored again.
- No duplicate `pos_void` movement.

### 6.3 Refunded Order Cannot Be Voided

Input:

- Order with status `refunded`.

Expected:

- RPC rejects the request.
- No inventory changes.

### 6.4 Blank Reason Rejected

Input:

- Empty reason or whitespace-only reason.

Expected:

- RPC rejects the request.
- No writes occur.

## Step 7: Reconciliation After Each Test

Run ERP reconciliation after every checkout / void scenario.

Expected:

- ERP reconciliation remains 0.
- No negative inventory.
- No duplicate idempotency keys.
- Completed orders have `sale / pos_sale`.
- Voided orders have `return / pos_void`.

## Step 8: Existing App Smoke Tests

Open and verify:

- `/`
- `/admin`
- inventory tab
- POS tab
- POS orders tab
- `/feed.xml`

Expected:

- All pages load normally.
- Existing JS checkout and void paths still work because `USE_POS_RPC` remains false.
- Feed remains unchanged.

## Rollback

Short-term rollback:

- Keep `USE_POS_RPC=false`.
- API routes continue to use existing Supabase JS paths.

Database rollback, if needed in a later migration:

```sql
drop function if exists app_private.pos_void_rpc(uuid, text, text, text);
drop function if exists app_private.pos_checkout_rpc(text, text, jsonb, numeric, text, text);
drop function if exists public.pos_void_rpc(uuid, text, text, text);
drop function if exists public.pos_checkout_rpc(text, text, jsonb, numeric, text, text);
drop function if exists app_private.pos_order_payload(uuid, boolean);
drop function if exists app_private.pos_sync_legacy_stock_from_erp(bigint);
```

Do not drop POS or ERP tables.

## Do Not Enter Production If

- Test database RPC migration fails.
- Function execute permissions are wrong.
- `anon` or `authenticated` can execute RPC functions.
- Checkout idempotency fails.
- Void idempotency fails.
- ERP reconciliation is not 0.
- Production read-only checks show issues.
- There is no fresh production backup.

## Later API Route Switch Plan

This phase does not change API routes. Later:

1. Add `USE_POS_RPC=false`.
2. In checkout route:
   - Keep dryRun on current JS preview path.
   - If `USE_POS_RPC=true`, call `supabase.rpc("pos_checkout_rpc", ...)` with the service-role client.
   - If false, keep current JS multi-step logic.
3. In void route:
   - If `USE_POS_RPC=true`, call `supabase.rpc("pos_void_rpc", ...)` with the service-role client.
   - If false, keep current JS multi-step logic.
4. RPC returns `affected_skus` and `affected_product_ids`.
5. API route refreshes product cache after successful RPC.
6. Keep old JS logic as fallback until production is stable.
