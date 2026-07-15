\## 1. Development stage rule



This application is still in a pre-release stage. It currently has no real users and no real production data.



Agents may make structural changes freely when needed, including database schema changes, UI changes, API changes, and logic refactors. Do not over-optimize for backward compatibility at this stage.



Production constraints, real user data safety, migrations, and long-term compatibility will be handled before the official release.



\---



\## 2. AgentMD purpose rule



The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project.



If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the AgentMD file to help prevent future agents from having the same issue.


\---


\## 3. Database initialization source of truth


The migration chain now starts with `supabase/migrations/20260702000000_baseline_store_schema.sql`. It creates `products.id` as `bigint` and has been verified from an empty local database with `npx supabase db reset`.


Use the migration chain as the development and upgrade source of truth. For a brand-new customer, `supabase/client-init.sql` is the supported one-file SQL Editor deployment snapshot generated from that chain. Regenerate it with `scripts/build-client-init.ps1` whenever migrations change. Never run it on an existing customer database or mix it with migration-based upgrades.


\---


\## 4. Local development port collision


Port `3000` may already be occupied by another workspace (observed serving the unrelated "华人生活+" project while this repository was being verified).


Before treating localhost responses as clothing-store verification, confirm the page identity or start this project on an explicit unused port such as `3010`. Do not stop or modify the other project's process unless the developer explicitly requests it.


\---


\## 5. Documentation encoding and stale deployment guidance


The previous deployment documentation was observed with mojibake and conflicting database initialization instructions.


Keep edited Markdown files in UTF-8. Customer-facing documentation should use the generated one-file `client-init.sql` flow; developer documentation should keep migrations as the source of truth for schema changes and existing-customer upgrades.


\---


\## 6. Local Supabase CLI collisions


The root `.env.local` was observed with a UTF-8 BOM, which Supabase CLI 2.109.1 rejected as an invalid environment-variable name. Do not expose or overwrite its secrets while working around this; remove the BOM safely or temporarily exclude the file from CLI startup.


Another workspace may already run local Supabase on the default 5432x ports. If `supabase/config.toml` currently defines dedicated 5532x ports, use that checked-in configuration; do not assume those ports without inspecting the file. Before `supabase start`, confirm Docker Desktop is running and inspect active containers for projects such as `huaren_life_plus`, `restaurant`, or `clothing_web`.


If database, Studio, or API ports conflict, change only this repository's `supabase/config.toml` and record the new convention here. Do not stop or modify another project's Supabase containers to verify this repository.


\---


\## 7. Legacy customer database migration dependencies


The production Supabase project was observed without the shared `public.set_updated_at()` trigger function even though newer empty-database initialization creates it in the baseline migration.


Upgrade migrations that create an `updated_at` trigger must create or replace their required trigger helper in the same migration. Do not assume an older customer database has executed the current baseline migration. Keep these upgrade migrations idempotent and verify both an empty local reset and the legacy-database upgrade path.


\---


\## 8. Next.js development and production build collision


This repository was observed returning temporary local 500 errors when `next build` ran while `next dev` was still using the same `.next` directory. The development and production build processes can overwrite each other's manifests and generated chunks.


Before running `npm run build`, stop this repository's development server. After the build finishes, restart `npm run dev -- -p 3010` before continuing Playwright or browser verification. Do not treat errors caused by concurrent `next dev` and `next build` as application regressions until the development server has been restarted cleanly.


\---


\## 9. Developer-only store and legal settings


Store Settings and Legal Settings intentionally do not use normal admin roles, including `owner`. They require the separate developer session backed by the salted hash in `public.developer_access`. Never replace this with `settings:write`, expose the credential through a public API, or add the plaintext password to environment variables, documentation, source code, screenshots, or logs.


The settings image-upload route is also reused by category management. Keep `categories:write` access for that upload path so normal catalog work is not broken, but keep the store-settings and legal-settings read/write APIs developer-only.


\---


\## 10. Customer version feature source of truth


`lib/feature-catalog.ts` is the shared source of truth for Basic, Standard, Advanced, feature labels, fixed core features, and dependency behavior. Do not duplicate plan presets inside the Settings page or admin dashboard.


Feature disabling must cover all four layers where applicable: public storefront copy/actions, admin navigation and controls, direct API calls, and employee authentication. The previous implementation left the public AI launcher, product AI button, Skroutz storefront copy, and employee account authorization active after their feature flags were disabled. Keep these surfaces gated and use the safe Basic preset while feature configuration is loading or unavailable so premium modules do not flash open.


\---


\## 11. AI shopping assistant sizing data boundaries


The product page was previously observed passing `size_stock` to the AI assistant as `size_chart`. These fields are not interchangeable: `size_stock` is availability by label, while `size_chart` is the product's measurement or fit reference. Keep both values separate through product loading, client context, and server prompt construction.


AI size and stock answers must use an authoritative server-side product record selected by SKU. Do not trust browser-supplied product fields as the source of truth. Include `size_system`, distinguish available sizes from sold-out sizes, and never infer conversions between letter, EU women's numeric, EU men's numeric, EU shoe, One Size, or custom sizing without an explicit product `size_chart` mapping.


\---


\## 12. POS transaction safety boundary


Formal POS checkout and void writes are RPC-only. `USE_POS_RPC=true` is required when POS is enabled; false, missing RPC migrations, missing execute privilege, or an unavailable RPC must fail closed with HTTP 503. Never restore the historical Supabase JS multi-step fallback.


Checkout legal versions and actor identity are written inside the checkout transaction. Void completion must reconcile every order Variant against `pos_void` movement quantities; an inconsistent or indeterminate ledger must return `POS_VOID_RECONCILIATION_REQUIRED` instead of reporting success. Preserve the browser business operation ID across timeouts and response loss so retries reuse the same database idempotency key.


\---


\## 13. Inventory transaction safety boundary


Inventory adjustment and Quick Sell writes are RPC-only through `public.inventory_apply_rpc`. The operation record, locked inventory balance, stock movement, and legacy `products.stock` / `products.size_stock` projection must commit or roll back together. Missing migrations, execute privilege, PostgREST, or RPC availability must fail closed with HTTP 503; never add a Supabase JS multi-step fallback.


Quick Sell is an owner-only inventory shortcut and intentionally does not create a POS order, payment, or receipt. Staff must use the POS checkout flow. Both inventory adjustment and Quick Sell must preserve one browser business operation ID across double clicks, timeouts, response loss, and refreshes; an uncertain expired/corrupt ID requires explicit reconciliation before reset.


Product create/edit and CSV import still contain historical inventory compatibility writes outside this RPC boundary. Do not describe those paths as transactionally hardened or silently migrate them while working on inventory adjustment / Quick Sell. They need a separately scoped review and regression suite.


\---


\## 14. Per-customer developer credential boundary


Clean installations must leave `public.developer_access` empty. Never seed a developer plaintext password or reusable fixed hash in a migration, client-init snapshot, test, example, or document. A maintainer initializes each customer with `npm run developer:bootstrap -- --project-ref ...` using a local server-only Supabase service/secret key; rotation and recovery use the corresponding CLI, never a public web endpoint.


Every pre-existing developer credential is treated as potentially shared and must remain `must_rotate=true` until CLI rotation. Store Settings, Legal Settings, and Feature Settings must fail closed when the row is absent, invalid, or requires rotation. Developer session signatures bind the current hash, password version, and random credential version so any rotation invalidates every old Cookie.


The CLI-generated migration timestamp originally sorted before the repository's future-dated POS migrations. `20260715110000_harden_developer_credentials.sql` is intentionally later than `20260714234237_transactional_inventory_operations.sql`, `20260715100000_harden_pos_checkout_rpc.sql`, and `20260715100001_reconcile_pos_void_rpc.sql`. Keep this monotonic order for all later migrations and verify clean reset, client-init, legacy shared credential, and existing unique credential upgrades.

Batch 2's `20260714234237_transactional_inventory_operations.sql` predates the Batch 1 POS hardening migrations even though it was added later. A database that already records the `20260715100000_*` migrations but lacks `20260714234237` will make a normal `db push` fail closed. Do not rewrite migration history or run `client-init.sql`; inspect `db push --dry-run --include-all` and use `--include-all` only when the listed missing migrations are exactly expected. All new migrations must remain later than `20260715110000`.

