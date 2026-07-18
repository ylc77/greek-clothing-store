## Summary

Phase 6B hardens operational reporting, reconciliation, audit identity, barcode assignment, label/receipt printing, capacity handling, and database plus Storage recovery. It does not claim production or real-hardware verification.

### Reporting and reconciliation

- Use `Europe/Athens` for POS business days, reports, order timestamps, and receipts, including DST boundaries.
- Move daily aggregation, order listing, search, and reconciliation to service-only PostgreSQL RPCs.
- Detect partial order/item/payment/sale/void states per Variant instead of reporting a healthy order from partial evidence.
- Replace silent fixed row limits with explicit pagination on operational and public data paths.

### Audit and barcode safety

- Record structured actor id, role, authentication type, and event version.
- Enforce append-only audit rows, including against service-role update/delete.
- Make barcode assignment transactional, idempotent, advisory-locked, and concurrency-safe.
- Preserve the browser operation id across retries and uncertain network outcomes.

### Labels and receipts

- Read the real store name and contact details from Store Settings.
- Render Greek/English product snapshots without Chinese fallback in customer-facing print output.
- Support 40×30 mm labels and 58/80 mm receipts with deterministic print CSS and barcode SVG output.
- Gate mobile, tablet, desktop, and in-memory PDF layouts in Chromium.

### Backup and recovery

- Add maintainer-only backup, verify, and restore commands for roles, schema, application/Auth data, migration history, and all Storage objects.
- Hash every artifact and Storage object in a manifest.
- Refuse restore to a target containing application relations, Auth users, migration history, or Storage objects.
- Verify a complete restore into a second blank local Supabase and document RPO ≤ 24 hours and RTO ≤ 4 hours.

## Local verification

- 141/141 named unit tests.
- 156/156 named database and route integration cases.
- 25/25 installation-path assertions across seven suites.
- 21-migration empty reset, exact `client-init.sql`, and relevant legacy upgrades.
- Production build and 390/768/1440 browser gates.
- Four database backup files plus one real Storage object restored byte-for-byte in 68.7 seconds.
- Database security, advisors, reconciliation, cleanup, typecheck, npm audit, secret scan across 365 files, and `git diff --check` all pass.

The detailed evidence is in `docs/v1-phase-6b-local-verification.md`.

## Required before merge

- All four required GitHub jobs green for the exact PR HEAD.
- Isolated Vercel/Supabase Preview acceptance using only `greek-clothing-store-test` and `AUDIT_6B_` fixtures.
- Preview role/Feature matrix, POS reporting/reconciliation, audit, barcode, pagination, label/receipt, and recovery checks pass.
- Preview database, Storage, credential, Cookie, backup, and environment-variable cleanup proven complete.
- Solo-maintainer sign-off and immutable local/CI/Preview tags.

## Explicitly not verified

- Production deployment and customer data are not verified or modified.
- No real scanner, label printer, continuous paper, receipt printer, or offline decoder was available. Standard and Advanced therefore cannot be declared fully hardware-ready in this PR.
- Online payment, bank POS integration, fiscal receipt/myDATA, ESC/POS bridge, and unrelated UI work remain outside this phase.
