## Summary

Phase 5A closes the confirmed public product-data and JSON-LD injection risks without changing POS, inventory, product, or CSV transaction semantics.

- serialize product JSON-LD safely across HTML script boundaries
- replace public `products` wildcard reads with explicit Storefront, AI, Skroutz, and Sitemap contracts
- revoke anonymous/authenticated table-wide `products` SELECT and grant only approved public columns
- introduce explicit procurement read/cost/write permissions
- shape Products, Inventory, and Suppliers responses by owner/staff/inventory/readonly role
- make role-dependent admin responses dynamic and `private, no-store`
- add unit, raw-HTML, Route, PostgREST, database security, cache isolation, and install-path coverage

## Confirmed root causes

1. Stored product strings were passed through raw `JSON.stringify` into an HTML JSON-LD script, so `</script>` could terminate the script element.
2. RLS restricted product rows but the baseline still granted anonymous roles table-wide SELECT, which did not protect private columns.
3. Service-role admin queries returned complete product, inventory, and supplier records to every role with general read permission.
4. Role-dependent responses did not consistently prevent shared caching.
5. Public consumers maintained independent query strings and lacked a statically enforceable field contract.

## Database change

`20260716113954_restrict_public_product_data.sql`:

- enables/retains `products` RLS
- revokes table-wide SELECT from `anon` and `authenticated`
- grants SELECT only on the explicit public column set
- retains the active-products public RLS policy
- retains explicit service-role DML
- reloads the PostgREST schema cache

The migration does not delete or rewrite product or supplier data. `supabase/client-init.sql` was regenerated from all 16 ordered migrations.

## Role contract

- owner: complete existing procurement data and supplier maintenance
- inventory: minimum supplier identity/SKU/style/reorder fields required for stock work; no cost or supplier contact/tax/notes; no supplier writes
- staff/readonly: no procurement or supplier-private fields; supplier endpoint denied
- developer session/anonymous: not treated as an admin business identity

All role-dependent JSON responses use `Cache-Control: private, no-store, max-age=0`.

## Local verification

- `npm ci` and npm audit: 0 vulnerabilities
- `git diff --check`
- `npm run typecheck`
- `npm run build`
- 81/81 unit tests
- 131/131 integration tests
- P1, product 4A, CSV 4B, and Phase 5A database security gates
- local database advisors: no issues
- migration-chain empty reset
- client-init empty install
- origin/master-to-Phase-5A upgrade with private data preservation
- 15/15 install-path assertions across P1, product, CSV, and Phase 5A
- reconciliation and fixture cleanup
- source/migration/docs/tests/snapshot/browser-bundle secret scan

Detailed evidence: `docs/v1-phase-5a-local-verification.md`.

## Required Preview acceptance before merge

- confirm a branch-only Vercel Preview uses a dedicated test Supabase project
- apply all 16 migrations in order
- verify stored malicious JSON-LD values remain inert in raw HTML and the browser
- verify anonymous PostgREST public-column success and private-column denial
- verify owner/staff/inventory/readonly/developer/anonymous field matrix
- verify owner-to-low-role cache sequence
- test 390px, 768px, and 1440px views without regressions
- remove all test rows, Storage objects, credentials, and branch environment variables

## Scope exclusions

This PR does not implement Phase 5B image/Storage hardening, Phase 5C AI/auth abuse protection, Phase 6A Skroutz/SEO/legal work, Phase 6B operations/printing/backup work, or the final release gate.

Current conclusion:

> Local integration verified. GitHub CI, isolated Preview, and Production deployment are not yet verified.
