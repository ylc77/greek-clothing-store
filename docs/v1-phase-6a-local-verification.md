# Phase 6A local verification

Date: 2026-07-18

Branch: `codex/hardening-p2-channels-seo-legal`

Base: `b30e3efd5b8c2fc0b24a89835fc4988c1d14a9a6` (`origin/master`, Phase 5C merge commit)

Verified implementation HEAD before this report: `b927ee0`

## Scope completed locally

- Skroutz XML is generated from the server-side public product projection plus authoritative `MAIN_STORE` Variant balances.
- Reserved stock is removed from saleable quantity; inactive, test, malformed, insecure, undersized, untranslated, unbranded, unmapped-size, and out-of-stock records fail closed.
- Feed validation covers well-formed XML, pagination beyond 1,000 products, duplicate IDs, quantity/variation consistency, secure links, required identifiers, image requirements, and Skroutz crawler user agents.
- Greek is the default storefront language and English uses `?lang=en`; both are present in raw HTML metadata, canonical links, reciprocal `hreflang`, and sitemap alternates.
- Public pages have request-scoped CSP nonces and response security headers; admin pages are `noindex` in HTML and headers.
- Legal Settings stores independent Greek and English retail policies. Publishing is one PostgreSQL transaction and fails closed when bilingual required content or the RPC is unavailable.
- Cookie, Privacy, Terms, Shipping, Return, and Refund pages use the selected locale and disclose only enabled third parties.
- Storefront and admin login surfaces passed serious/critical axe checks, keyboard checks, and horizontal-overflow checks at 390, 768, and 1440 pixels.
- The existing four-job GitHub gate now runs the Phase 6A static, unit, database integration, build, and browser checks and uses Node 24-compatible GitHub actions.

## Commands and actual results

| Check | Result |
|---|---|
| `npm run check:channels-static` | PASS; 19 ordered migrations and exact `client-init.sql` snapshot verified |
| `npm run test:channels-unit` | PASS; 14/14 tests |
| `npm run typecheck` | PASS |
| `npm run test:legal-publish-integration` | PASS; grants, concurrent publish, rollback, and cleanup |
| `npm run test:channels-browser-local` | PASS; production build plus all raw HTML, header, axe, keyboard, and viewport checks |
| `npm run test:ai-auth-install-paths` | PASS; ordered migrations, client-init, unique legacy upgrade, and duplicate-email safe stop |
| `git diff --check` | PASS |

The first installation-path invocation was interrupted by the command runner timeout. A second invocation overlapped the first process cleanup and lost its temporary container. After confirming that no test process or test container remained, a clean invocation passed all four installation assertions. This was a local test-runner lifecycle issue, not a migration failure.

## Local database evidence

- Local Supabase uses the checked-in 5532x ports and PostgreSQL 17.
- All 19 migrations previously passed `npx supabase db reset --local --no-seed` from an empty database after the legal RPC correction.
- Legal publish RPC access is service-role only; anonymous and authenticated execution is revoked.
- Concurrent legal publishes generate unique sequential versions under one advisory transaction lock.
- Injected snapshot failure rolls back the settings update and version row together.
- Installation fixtures create Storage-owned schema objects through `supabase_storage_admin` and do not depend on startup timing.

## Remaining Preview gates

The following are intentionally not claimed as complete locally:

1. Deploy this exact branch to an isolated Vercel Preview connected only to `greek-clothing-store-test` (`krlhwwjkgoqzusehxuav`).
2. Apply the current 19 migrations to that isolated test project and verify the legal publish RPC grants and runtime behavior.
3. Create temporary `AUDIT_6A_` products with genuine English copy, brand, MPN, EAN, color, images over 1,000 pixels, additional fashion images, Variants, and `MAIN_STORE` balances.
4. Verify `/feed.xml` through the strict monitor and the official Skroutz XML Validator.
5. Verify Greek/English storefront, legal publishing, Cookie preferences, security headers, accessibility, and the admin readiness messages in Preview.
6. Delete all temporary database rows, Storage objects, developer credentials, cookies, and Preview-only secrets; prove zero residue.
7. Confirm the GitHub required jobs are green for the exact Preview-accepted HEAD.

## Production monitor status

The production Daily site monitor failure is not yet declared fixed. The workflow and Feed implementation are corrected on this branch, but the result requires deployment plus at least one eligible real or isolated Preview product. Production has not been modified or verified in Phase 6A local testing.

## Current decision

Local gate: **PASS**

Draft PR readiness: **READY AFTER final full regression and branch synchronization check**

Merge readiness: **BLOCKED until GitHub CI and isolated Preview acceptance, including the official Skroutz Validator**
