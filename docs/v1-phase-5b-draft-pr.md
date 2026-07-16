## Summary

Phase 5B closes the confirmed image ingestion, Storage consistency, server-side image fetch, and permanent product deletion risks without changing POS, inventory, product, or CSV transaction semantics.

- validate JPEG/PNG/WebP from magic bytes through bounded Sharp decode and always re-encode accepted files
- isolate product, store, and category objects with strict targets, immutable owner IDs, collision-resistant segments, and random UUID paths
- record upload/delete intent before Storage mutation and compensate or queue every partial failure
- restrict AI reference downloads to reviewed exact HTTPS origins with DNS, redirect, private-network, timeout, type, and streaming limits
- protect permanent deletion with a service-role-only transaction RPC and complete historical-reference checks
- add read-only reconciliation plus an explicitly confirmed trusted recovery CLI
- add unit, real local Storage/API, fault-injection, database security, and clean/client-init/legacy install coverage

## Confirmed root causes

1. Store Settings trusted browser MIME and fell back to saving raw input when Sharp failed; upload routes lacked one shared byte/pixel/dimension boundary.
2. Product, store, and category image flows wrote Storage and database references in separate best-effort steps, leaving orphan or dangling state on injected failures.
3. AI styling downloaded a browser-provided URL with plain server-side `fetch`, without DNS/redirect/private-network/stream limits.
4. Permanent product deletion checked only part of inventory history, deleted database state before best-effort Storage cleanup, and could not recover a failed object deletion.

## Database change

`20260716141423_harden_storage_image_lifecycle.sql`:

- adds optional product image dimensions
- creates service-role-only `storage_object_operations` and `product_delete_operations` recovery records with RLS and no public policy
- constrains the public-read `product-images` bucket to 10 MiB and JPEG/PNG/WebP
- adds `product_permanent_delete_prepare_rpc` with `SECURITY DEFINER`, empty `search_path`, explicit revoke/grant, row locking, idempotency, historical blockers, and transactional cleanup preparation

The migration does not rewrite existing image references. Legacy/external URLs are detached rather than automatically deleted. `supabase/client-init.sql` was regenerated from all 17 ordered migrations.

## Security contract

- public bucket means public read only; anon/authenticated writes remain denied
- server checks declared MIME, magic bytes, byte size, pixels, dimensions, animation/multipage state, and complete Sharp decode
- no raw-image fallback
- server fetch allows current customer Storage automatically and optional reviewed exact origins only; no wildcard hosts
- every resolved address must be public, redirects are revalidated, and transport uses the validated pinned address
- Storage success plus DB failure is compensated; DB reference removal plus Storage failure is queued and reported as pending
- permanent deletion is blocked by orders, stock movements, inventory/product operations, import records, non-zero balances, reserved stock, or legacy stock

## Local verification

- `npm ci` and npm audit: 0 vulnerabilities
- `git diff --check`
- `npm run typecheck`
- `npm run build`
- 98/98 unit tests
- 139/139 integration tests
- 18/18 install-path assertions
- P1, product 4A, CSV 4B, public-data 5A, and Storage 5B database/static security gates
- local database advisors: no issues
- migration-chain empty reset, client-init empty install, and legacy upgrade
- secret scan across source, migrations, docs, tests, snapshot, and browser bundle
- read-only reconciliation: zero orphan, missing, or pending paths and `mutated=false`
- final local business/test rows, recovery records, credentials, and Storage objects: zero

Detailed evidence: `docs/v1-phase-5b-local-verification.md`.

## Required Preview acceptance before merge

- confirm branch-only Vercel Preview uses dedicated test Supabase and no production/customer project
- apply all 17 migrations and verify bucket/table/RPC grants
- upload valid JPEG/PNG/WebP as owner; upload Logo/Hero as developer; upload category image with category permission
- prove anonymous, staff, inventory, and readonly cannot create, replace, or delete objects outside the designed role boundary
- reject forged MIME, SVG/script, malformed and oversized images without object residue
- inject or use the existing safe fixture for DB-reference/Storage-delete failure and verify compensation/recovery state
- verify safe permanent deletion removes one managed object and protected history/non-zero inventory cannot be deleted
- verify public storefront images and cache-busted replacements at 390px, 768px, and 1440px
- run read-only reconciliation and remove every test row, object, operation record, credential, and branch environment variable

## Scope exclusions

This PR does not implement Phase 5C AI rate limiting/auth abuse protection, Phase 6A Skroutz/SEO/legal/monitor work, Phase 6B reporting/printing/backup work, or the final release gate. It also does not migrate or automatically delete legacy external image URLs.

Current conclusion:

> Local integration verified. GitHub CI, isolated Preview, and Production deployment are not yet verified.
