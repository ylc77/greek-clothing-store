# POS Phase 1-E Production RPC Migration Checklist

This checklist is for production project `rgkdyksyztqaupatiltz`.

Do not paste a file path into Supabase SQL Editor. Paste the SQL content from:

`supabase/migrations/20260705000100_add_pos_rpc_functions.sql`

## Before Execution

- [ ] Production read-only checks all pass.
- [ ] Manual database backup is complete because the current Supabase project is on the Free plan.
- [ ] The same RPC migration version has passed on the test project.
- [ ] Confirm the target production ref is `rgkdyksyztqaupatiltz`.
- [ ] Pause admin product edits, inventory adjustments, CSV import, and POS operations during execution.
- [ ] Confirm `USE_POS_RPC=false`.
- [ ] Confirm no invoice, myDATA, provider API, or receipt printing code is included in this migration.

## Execution

- [ ] Open Supabase SQL Editor for production project `rgkdyksyztqaupatiltz`.
- [ ] Copy the SQL content from `supabase/migrations/20260705000100_add_pos_rpc_functions.sql`.
- [ ] Paste the SQL content into SQL Editor.
- [ ] Execute the SQL content.
- [ ] Confirm the SQL completes successfully.

## After Execution Verification

- [ ] `public.pos_checkout_rpc` exists.
- [ ] `public.pos_void_rpc` exists.
- [ ] `app_private.pos_order_payload` exists.
- [ ] `app_private.pos_sync_legacy_stock_from_erp` exists.
- [ ] `anon` cannot execute `public.pos_checkout_rpc`.
- [ ] `anon` cannot execute `public.pos_void_rpc`.
- [ ] `authenticated` cannot execute `public.pos_checkout_rpc`.
- [ ] `authenticated` cannot execute `public.pos_void_rpc`.
- [ ] `service_role` can execute `public.pos_checkout_rpc`.
- [ ] `service_role` can execute `public.pos_void_rpc`.
- [ ] `app_private` is not added to exposed schemas.
- [ ] ERP reconciliation still returns 0 issues.
- [ ] Homepage works.
- [ ] Admin works.
- [ ] Inventory tab works.
- [ ] POS tab works.
- [ ] `/feed.xml` works.

## After Migration Feature Flag Plan

- [ ] Keep RPC disabled after this migration succeeds.
- [ ] Do not change production behavior in this step.
- [ ] Next phase: update API routes with `USE_POS_RPC` feature flag.
- [ ] Default `USE_POS_RPC=false`.
- [ ] Deploy dual-path API code first.
- [ ] Enable `USE_POS_RPC=true` in test environment first.
- [ ] Run checkout and void tests in test environment.
- [ ] Consider enabling `USE_POS_RPC=true` in production only after test validation passes.

## Rollback Notes

- This migration only creates or replaces RPC functions and helper schema/functions.
- If execution fails before completion, stop and inspect the exact error before retrying.
- If RPC behavior is wrong after deployment, keep `USE_POS_RPC=false` so production API routes continue using the current non-RPC path.
- Do not drop POS tables or ERP tables as part of rollback.
