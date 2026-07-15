# POS RPC Production Rollout Log

## Rollout Summary

- Environment: Production
- Supabase project ref: `rgkdyksyztqaupatiltz`
- Feature flag after rollout: `USE_POS_RPC=true`
- Rollout time: 2026-07-04
- Scope: POS checkout and void now use PostgreSQL RPC transaction path in production.
- Excluded scope: invoices, myDATA, receipt printing, refund flow, frontend product display changes.

## Smoke Test Record

- Test SKU: `DEMO-BAGS-HANDBAGS-001`
- Order number: `POS-20260704-081709-0F7CE9`
- Order ID: `32e25988-2d1d-4e0f-8765-fef3134c074b`
- Payment method: `cash`
- Total: `51.90 EUR`

## Checkout Result

- Checkout status: Passed
- Initial stock: `10`
- Stock after checkout: `9`
- Repeated checkout idempotency: Passed
- Repeated checkout result: `alreadyProcessed=true`
- Sales order created: Yes
- Sales order item created: Yes
- Payment created: Yes

## Void Result

- Void status: Passed
- Stock before void: `9`
- Stock after void: `10`
- Repeated void idempotency: Passed
- Repeated void result: `alreadyProcessed=true`
- Order status after void: `voided`
- Payment status after void: `voided`

## Stock Movements

- Checkout movement:
  - `movement_type=sale`
  - `source_type=pos_sale`
  - `reason=POS sale`
  - `quantity_before=10`
  - `quantity_after=9`
  - `quantity_delta=-1`
- Void movement:
  - `movement_type=return`
  - `source_type=pos_void`
  - `reason=Production RPC smoke test void restore inventory`
  - `quantity_before=9`
  - `quantity_after=10`
  - `quantity_delta=1`

## Reconciliation

- ERP reconciliation result: Passed, 0 issues.
- `products.stock` restored to: `10`
- `products.size_stock` restored to: `{ "ONE SIZE": 10 }`
- `inventory_balances.quantity_on_hand` restored to: `10`

## Page Smoke

- Home page `/`: Passed, HTTP 200
- Admin `/admin`: Passed, HTTP 200
- Skroutz feed `/feed.xml`: Passed, HTTP 200

## Rollback Plan

If POS RPC checkout or void shows production issues:

1. Set Vercel Production environment variable `USE_POS_RPC=false`.
2. Redeploy Production.
3. Confirm POS checkout and void now return the explicit configuration block; do not use a JS fallback.
4. Preserve the failed order number, SKU, timestamp, and API response.
5. Run `supabase/pos-runtime-health-checks.sql`.
6. Run `supabase/erp-phase-1-reconciliation-checks.sql`.
7. Repair data manually only after identifying the exact mismatch.

## Daily Operating Recommendation

- Keep `USE_POS_RPC=true` after this successful rollout.
- For the first few business days, run the POS runtime health check after closing.
- If any check returns rows, pause POS checkout and void before continuing sales.
- Keep the historical Supabase JS path unreachable; RPC failure must block writes instead of falling back.
