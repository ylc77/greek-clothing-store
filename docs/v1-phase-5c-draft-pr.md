## Summary

Phase 5C replaces process-local AI and password-abuse controls with shared database enforcement, minimizes AI customer data, hardens emergency/developer authentication, restores employee token lifecycle, and normalizes authorization responses.

- enforce shared IP/session/store/global AI rate limits, daily budget, concurrency leases, replay, and timeout
- require explicit consent for body measurements and keep those values out of persistence and logs
- rebuild bounded AI product context from server-authoritative public fields and constrain recommended SKUs
- validate optional emergency passwords at startup and use timing-safe verification plus shared cross-instance failure limits
- apply the same shared limiter to developer login without exposing a bootstrap/reset endpoint
- restore Supabase employee sessions across refresh, token rotation, expiry, and local sign-out
- normalize unauthenticated 401, unauthorized 403, feature-disabled 403, rate-limited 429, and unavailable 503 responses
- add RLS/grant/RPC, multi-instance, fault, PII-log, session, regression, and install-path coverage

## Database change

`20260716170000_ai_auth_abuse_protection.sql` creates four service-role-only tables and four security-definer RPCs for shared AI and authentication state. All tables use RLS with no public policy; RPCs have an empty search path and explicit execute grants. The migration also normalizes admin emails and adds case-insensitive uniqueness, stopping safely when legacy case duplicates exist.

`supabase/client-init.sql` is regenerated from all 18 ordered migrations.

## Security contract

- no process-local fallback when shared security state is unavailable
- no body measurements without explicit consent; no persistence or logs
- no browser-authoritative product fields or arbitrary model-recommended SKU
- no unlimited request body, provider response, timeout, daily spend, or concurrency
- no weak or cross-role duplicate emergency password
- no raw password, token, service key, measurement, or HMAC input in logs
- no environment owner escalation to developer-only settings
- no authenticated authorization failure mislabeled as an unauthenticated success/failure path

## Local verification

- 113/113 total unit tests, including 15/15 Phase 5C tests
- 149/149 total integration tests, including 10/10 Phase 5C multi-instance tests
- 22/22 total install-path assertions, including 4/4 Phase 5C clean/client-init/legacy fixtures
- RLS, grants, search path, budget, concurrency, replay, and cleanup gates
- POS, inventory, developer, feature, product, CSV, public-data, and Storage regressions
- local 18-migration reset
- typecheck, production build, diff check, secret scan, database advisors, and final cleanup

Detailed evidence: `docs/v1-phase-5c-local-verification.md`.

## Preview acceptance

- exact HEAD `ce5c6993d5894117eec5e95b36a692977f545820` deployed to isolated Vercel Preview `dpl_9cCawhuhM1M8gXsuegBMF2UxpFqd`
- Preview used only `greek-clothing-store-test` (`krlhwwjkgoqzusehxuav`, `eu-west-3`) with 18 ordered migrations
- private table/RPC grants, server-authoritative product projection and owner/staff/inventory/readonly direct API matrix passed
- AI consent, bounded context, shared replay/concurrency, provider-unavailable and budget/limit failure boundaries passed
- Developer session Cookie hardening, credential rotation, old-session invalidation and employee Supabase token refresh/sign-out passed
- 390px, 768px and 1440px checks had no horizontal overflow, hydration error or blocking console error
- Vercel log scan found no password, token, service key, Cookie or measurement leakage
- all prefixed products, accounts, credentials, limiter rows, AI leases and Storage fixtures were removed; final residue counts were zero

Detailed evidence: `docs/v1-phase-5c-preview-verification.md`.

## Scope exclusions

This PR does not address Phase 6A feed/SEO/legal/accessibility work, Phase 6B reporting/printing/backup/hardware work, or final production release. It does not add a real payment provider or change POS, inventory, product, CSV, or Storage transaction semantics.

Current conclusion:

> Local integration, exact-HEAD GitHub CI, and isolated Vercel Preview acceptance verified. Production deployment is not verified.
