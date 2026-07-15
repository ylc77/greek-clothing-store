# Draft PR: P1 transaction, authorization, and credential hardening

> Suggested title: `fix: complete P1 transaction and security hardening`
>
> Status: Draft until the GitHub workflow has passed and the remote deployment preconditions below have been confirmed manually.

## Why this change is required

The first three remediation batches addressed seven confirmed P1 issues in POS, inventory, Quick Sell, and per-customer developer credentials. This integration batch makes those fixes reviewable and releasable as one unit: it normalizes the unpublished migration order, deletes unreachable unsafe write fallbacks, adds PR gates, verifies all local install/upgrade paths, and supplies a single deployment and rollback runbook.

## Confirmed P1 mapping

| P1 | Previous risk | Resolution |
|---|---|---|
| P1-01 | `USE_POS_RPC=false` could use a non-transactional checkout path and leave a partial order | Checkout writes are RPC-only and return 503 before any write when RPC mode/configuration is unavailable |
| P1-02 | Legacy void logic could treat one restore movement as a completely restored order | `pos_void_rpc` reconciles expected and restored quantity per Variant, restores only the difference, and fails with `POS_VOID_RECONCILIATION_REQUIRED` on inconsistent ledgers |
| P1-03 | Concurrent inventory adjustment could lose updates or split ERP/legacy projections | `inventory_apply_rpc` locks and commits the operation record, balance, movement, and compatibility projections in one transaction |
| P1-04 | Quick Sell could oversell or partially update inventory | Quick Sell uses the same transactional inventory RPC and never falls back to legacy-first writes |
| P1-05 | Staff could call Quick Sell directly | The server route is owner-only; feature disabling is also checked before writes |
| P1-06 | Checkout, void, inventory, and Quick Sell retries could receive new business IDs | Browser operation IDs survive repeated clicks, response loss, retry, and refresh. This integration review also fixed the void request body so it sends the persisted ID instead of a new UUID |
| P1-07 | New customers could share a seeded developer credential | Clean installs are uninitialized; trusted local CLI bootstrap/rotation generates independent salted credentials and credential versions per customer, and rotation invalidates every old Cookie |

## Architecture and database changes

- Formal POS checkout and void writes are transaction RPC-only.
- Inventory adjustment and Quick Sell use one transaction RPC and an `inventory_operations` idempotency ledger.
- Store Settings, Legal Settings, and Feature Settings writes require a valid developer session; owner/staff roles do not inherit developer access.
- Developer session signatures bind the credential hash, password version, credential version, nonce, and expiry.
- Public and authenticated roles cannot read/write `developer_access` or execute the protected write RPCs. `service_role` is used only by server/maintainer paths.

Database objects introduced or hardened:

- `public.pos_checkout_rpc(... nine arguments ...)`
- `public.pos_void_rpc(uuid, text, text, text)`
- `public.pos_runtime_health_rpc()`
- `public.inventory_operations`
- `public.inventory_apply_rpc(...)`
- `public.inventory_runtime_health_rpc()`
- `public.developer_access`
- `public.developer_credential_hash_is_valid(text)`
- `public.developer_credential_bootstrap_rpc(text, uuid)`
- `public.developer_credential_rotate_rpc(text, uuid, uuid)`

## Migration order

The P1 migrations are now monotonic and dependency-readable:

1. `20260715100000_harden_pos_checkout_rpc.sql`
2. `20260715100001_reconcile_pos_void_rpc.sql`
3. `20260715102000_transactional_inventory_operations.sql`
4. `20260715110000_harden_developer_credentials.sql`

The transactional inventory migration was renamed rather than duplicated. The rename is based on repository evidence that the P1 branch has not been pushed or merged. This work intentionally did not query any remote Supabase project. Before first remote deployment, the maintainer must still confirm that no target migration history contains the pre-rename unpublished inventory version.

`supabase/client-init.sql` was regenerated from all 13 ordered migrations and is checked byte-for-byte in CI.

## Fail-closed and idempotency behavior

- Missing configuration, missing RPC, missing execute privilege, or unavailable PostgREST returns 503 without business writes.
- Feature-disabled endpoints return 403/404 before protected writes or public feature exposure.
- Replayed request IDs return the original committed result.
- Reusing an idempotency key with unsafe/inconsistent state is rejected rather than silently creating another result.
- Void over-restoration and unknown inventory operation state require reconciliation instead of reporting success.

## New customer deployment

1. Run `supabase/client-init.sql` only in a brand-new empty project.
2. Configure server-only Vercel/Supabase values; never expose the service/secret key to the browser.
3. From the maintainer's computer, confirm the customer project ref and run `npm run developer:bootstrap -- --project-ref ...`.
4. Save the one-time password in the maintainer password manager.
5. Confirm `USE_POS_RPC=true` before enabling POS.
6. Run the launch checklist in `docs/p1-release-runbook.md`.

## Existing customer upgrade

1. Take a backup and confirm the linked project ref.
2. Run `npx supabase db push --dry-run`; stop if any migration is unexpected.
3. Confirm the old unpublished inventory migration version is absent.
4. Run `npx supabase db push`.
5. Existing developer credentials enter `must_rotate`; run `npm run developer:rotate -- --project-ref ...`.
6. Revalidate POS health, authorization, reconciliation, Store/Legal/Feature Settings, and customer-specific business flows.

Never execute `client-init.sql` on an existing customer database and do not edit migration history manually.

## Test matrix and actual local result

- `npm ci`: passed
- `git diff --check`: passed
- `npm run typecheck`: passed
- `npm run build`: passed on Next.js 15.5.19
- P1 unit tests: 24/24 passed (POS ID 5, inventory ID 8, developer credentials 6, Feature catalog 5)
- POS integration: 18/18 passed
- Inventory integration: 22/22 passed
- Developer credential integration: 12/12 passed
- Feature Gate integration: 5/5 passed
- Migration-chain empty reset: passed, 13/13 migrations applied
- Normal local migration dry-run: no pending migrations
- POS client-init and legacy migration-chain paths: passed
- Inventory client-init and legacy migration-chain paths: passed
- Developer client-init, fixed-legacy, and existing-unique credential paths: passed
- RLS/RPC/grant/SECURITY DEFINER checks: passed
- Supabase database advisors: no issues
- Secret scan: passed across source, migrations, docs, tests, generated snapshot, and browser bundle
- Test cleanup/reconciliation check: passed
- `npm audit`: 0 vulnerabilities after a compatible PostCSS override; no forced or major downgrade was used

`supabase db lint` reports two static parsing findings for transaction functions that create and use runtime temporary tables. The same statements execute successfully in the POS integration suite, including concurrency and injected rollback failures. This is recorded as a lint-tool limitation rather than hidden.

## PR automation

The workflow `.github/workflows/p1-remediation-gate.yml` runs four required jobs without production URLs or customer secrets:

1. Static quality, build, snapshot drift, browser/source secret scan, and dependency audit.
2. P1 unit tests.
3. Isolated local Supabase reset, integration/security/advisor/cleanup checks.
4. Clean, client-init, and legacy upgrade paths.

The workflow has been syntax-checked and its commands were run locally. It has not run on GitHub because this branch has not been pushed and no PR has been opened.

## Out of scope (P2/P3)

- Product create/edit and CSV legacy/ERP transactional refactor
- AI, images, SEO, Skroutz, printing, and JSON-LD changes
- AdminDashboard redesign or UI polishing
- Other P2/P3 issues

## Rollback

- Application/CI/test/doc commits can be reverted independently in reverse order.
- Do not down-migrate a customer database after business writes have used the new ledgers/RPCs. Restore a verified pre-deployment backup or ship a forward corrective migration.
- For a brand-new disposable project with no data, recreate the empty project from the last known-good snapshot.
- Credential rotation is intentionally irreversible: recover by running the trusted service-role CLI to rotate again, never by restoring a shared password.

## Pre-merge and launch checklist

- [ ] Push this branch and open a Draft PR.
- [ ] Require all four `P1 remediation gate` jobs in branch protection.
- [ ] Require an up-to-date branch, resolved review conversations, and at least one approval.
- [ ] Confirm no remote target ever applied the pre-rename unpublished inventory migration.
- [ ] Review `origin/master...HEAD`, including the P1-06 void-ID integration fix.
- [ ] Confirm target project ref, backup, dry-run plan, server-only secrets, and `USE_POS_RPC=true`.
- [ ] Execute the remote deployment checklist separately; do not infer remote success from local tests.
