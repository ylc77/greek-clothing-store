# Phase 6B local verification

Date: 2026-07-18

Branch: `codex/hardening-p2-operations-reporting-print`

Base: `0c390572260bf5aa46de341d9eceab58d4b9d0bb` (`origin/master`, Phase 6A merge commit)

Final evidence anchor: annotated tag `audit-v1-6b-local-verified-v3` (the original and v2 tags remain preserved at their pre-CI-fix commits)

## Scope completed locally

- POS business dates, reports, order timestamps, and receipts use `Europe/Athens`, including winter time, summer time, DST transition days, and the Athens midnight boundary.
- Daily totals are computed in PostgreSQL. Order, report, product, category, inventory-movement, failed-import-row, and label data access uses explicit pagination instead of silent 200/500/1,000 row limits.
- Service-only reconciliation detects missing order items, missing payments, and sale/void quantity mismatches per Variant.
- Audit events record structured actor user id, role, authentication type, and event version. Audit rows are append-only; the service role has read access but no update or delete access.
- Barcode writes are transactional, advisory-locked, idempotent, and concurrency-safe. Browser retries preserve the same operation id.
- Labels and receipts use current store settings and Greek/English product snapshots. Automated browser checks cover 40×30 mm labels, 58/80 mm receipts, rendered barcodes, in-memory PDF output, and 390/768/1440 pixel viewports.
- Maintainer-only backup, manifest verification, and restore commands cover database roles, schema, application/Auth data, migration history, and every Storage object. Backups include SHA-256 hashes and no service key or database password.
- Recovery refuses a non-empty target before mutation. The database password is provided to a one-shot PostgreSQL client through standard input.
- The existing four-job GitHub gate now runs Phase 6B static, unit, integration, install-path, browser, security, and recovery checks.

## Commands and actual results

| Check | Result |
|---|---|
| `npm ci` | PASS; 127 packages installed, 0 vulnerabilities |
| All P1/4A/4B/5A/5B/5C/6A/6B unit suites | PASS; 141/141 named tests |
| All database and route integration suites | PASS; 156/156 named cases |
| `npm run check:operations-static` | PASS; 21 ordered migrations and exact generated `client-init.sql` snapshot |
| `npm run check:operations-db-security` | PASS; 7/7 operations privilege and immutability gates |
| `npx supabase db reset --local --no-seed` | PASS; all 21 migrations apply from an empty database |
| Seven installation-path suites | PASS; 25/25 clean migration, client-init, and legacy assertions |
| `npm run test:operations-backup-restore` | PASS; four database files and one Storage object restored byte-for-byte in 78.7 seconds after the platform-independent script fix |
| `npm run test:channels-browser-local` | PASS; production build, multilingual/SEO/security/accessibility checks, and label/receipt checks at 390/768/1440 |
| `npm run typecheck` | PASS |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilities |
| Database advisors | PASS; no findings |
| POS, inventory, product, CSV, Storage, and operations reconciliation | PASS; no unresolved mismatch |
| Test cleanup | PASS; no installation or recovery containers and no temporary backup directory remain |
| `npm run test:developer-secrets` | PASS across 365 source, migration, documentation, test, snapshot, and browser-bundle files |
| `git diff --check` | PASS |

## Local database and recovery evidence

- The complete 21-migration chain starts from `20260702000000_baseline_store_schema.sql` and ends with `20260718105030_operations_reporting_audit_barcode.sql`.
- `supabase/client-init.sql` was regenerated from that chain and is byte-for-byte accepted by the operations static gate.
- Installation verification covers an ordered empty migration chain, an empty `client-init.sql` installation, relevant legacy upgrade fixtures, and repeated execution safety.
- Operations RPCs and private reconciliation data are service-role-only. Public, anonymous, and authenticated execute/read access is revoked where applicable.
- The recovery drill restored 21 migration-history rows, application fixtures, and an actual Storage object to a second blank local Supabase. The restored object hash matched the backup manifest.
- The latest local recovery took 78.7 seconds, below the documented RTO target of four hours. The current RPO target is 24 hours and requires daily database plus Storage backups.
- Backup and restore temporary directories and the isolated recovery container were removed after the drill.

## Remaining CI and Preview gates

The following are intentionally not claimed as complete locally:

1. Push this exact branch and annotated local verification tag.
2. Create a Draft PR and obtain all four required GitHub checks for the exact PR HEAD.
3. Deploy the exact commit to an isolated Vercel Preview connected only to `greek-clothing-store-test` (`krlhwwjkgoqzusehxuav`).
4. Apply and verify all 21 migrations on that isolated project without touching a customer or production project.
5. Verify role/Feature gates, POS reporting/reconciliation, barcode idempotency, audit immutability, label/receipt rendering, and pagination with `AUDIT_6B_` fixtures.
6. Back up the isolated test project and restore it only into another blank isolated target; never restore over the source Preview project.
7. Delete every Preview database row, Storage object, credential, Cookie, backup artifact, and branch-only environment value, then prove zero residue.
8. Complete solo-maintainer sign-off and immutable CI/Preview tags before merge.

## External hardware gates

The following were not run because real hardware is not available to automation:

- USB/Bluetooth barcode scanner input and repeated rapid scans.
- Physical 40×30 mm label printer output and continuous-paper offset calibration.
- Physical 58/80 mm receipt printing and browser margin/cut behavior.
- Offline barcode decoding and reconnect behavior.

These are explicit external gates, not test skips. Basic may continue through software release gates without them. Standard and Advanced must remain `BLOCKED` or later be marked `CONDITIONAL`; neither may be declared fully hardware-ready until these checks are recorded with real devices.

## Current decision

Local gate: **PASS**

Draft PR readiness: **READY after final branch synchronization and immutable local tag**

Merge readiness: **BLOCKED until GitHub CI and isolated Preview acceptance**

Production readiness: **NOT VERIFIED**
