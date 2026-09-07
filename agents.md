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


Supabase CLI 2.109.1 was also observed printing full legacy API keys from `npx supabase projects api-keys --project-ref ... --output json` even when `--reveal` was not supplied. Never run this command in logged, captured, shared, or CI output. Treat any exposed key as compromised and rotate or revoke it immediately; do not copy the output into reports, screenshots, chat, or repository files.


Another workspace may already run local Supabase on the default 5432x ports. If `supabase/config.toml` currently defines dedicated 5532x ports, use that checked-in configuration; do not assume those ports without inspecting the file. Before `supabase start`, confirm Docker Desktop is running and inspect active containers for projects such as `huaren_life_plus`, `restaurant`, or `clothing_web`.


If database, Studio, or API ports conflict, change only this repository's `supabase/config.toml` and record the new convention here. Do not stop or modify another project's Supabase containers to verify this repository.


\---


\## 7. Legacy customer database migration dependencies


The production Supabase project was observed without the shared `public.set_updated_at()` trigger function even though newer empty-database initialization creates it in the baseline migration.


Upgrade migrations that create an `updated_at` trigger must create or replace their required trigger helper in the same migration. Do not assume an older customer database has executed the current baseline migration. Keep these upgrade migrations idempotent and verify both an empty local reset and the legacy-database upgrade path.


The pre-release Production database also used the product SKU itself for some existing `ONE SIZE` Variants, while the maintained ERP reconciliation can derive a size-suffixed candidate SKU from `products.size_stock`. During legacy upgrades, reuse Variants by the catalog identity `(product_id, coalesce(size, ''), coalesce(color, ''))` and preserve the existing `variant_sku`; matching only on the newly derived SKU can violate the product/size/color unique index and block the upgrade.


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


CSV import uses its own transaction and recovery boundary below. Do not route ordinary inventory work through the CSV import Job model.


\---


\## 14. Per-customer developer credential boundary


Clean installations must leave `public.developer_access` empty. Never seed a developer plaintext password or reusable fixed hash in a migration, client-init snapshot, test, example, or document. A maintainer initializes each customer with `npm run developer:bootstrap -- --project-ref ...` using a local server-only Supabase service/secret key; rotation and recovery use the corresponding CLI, never a public web endpoint.


Every pre-existing developer credential is treated as potentially shared and must remain `must_rotate=true` until CLI rotation. Store Settings, Legal Settings, and Feature Settings must fail closed when the row is absent, invalid, or requires rotation. Developer session signatures bind the current hash, password version, and random credential version so any rotation invalidates every old Cookie.


The unpublished P1 migrations are intentionally ordered as `20260715100000_harden_pos_checkout_rpc.sql`, `20260715100001_reconcile_pos_void_rpc.sql`, `20260715102000_transactional_inventory_operations.sql`, and `20260715110000_harden_developer_credentials.sql`. Keep this monotonic order for all later migrations and verify clean reset, client-init, POS/inventory legacy upgrades, legacy shared credential, and existing unique credential upgrades.


The standalone Supabase Postgres image used by installation-path tests may finish assigning the `storage` schema to `supabase_storage_admin` before the fixture runs, especially on Ubuntu GitHub runners. The `postgres` role then has no CREATE privilege on that schema even though the same test can pass during a different Windows startup window. Create the fixture `storage.buckets` table through `supabase_storage_admin` and explicitly grant the test `postgres` role the required DML privileges; do not rely on startup timing or change the production migration for this test-only ownership boundary.


\---


\## 15. Product transaction safety boundary


Formal product creation and editing are RPC-only and require `USE_PRODUCT_RPC=true`. A false setting, missing product transaction migration, missing execute privilege, unavailable PostgREST, or RPC failure must fail closed with HTTP 503 before any product business write. Never restore the historical Node.js sequence that wrote `products`, Variants, balances, and movements independently.


`inventory_balances` is the authoritative inventory source. Legacy `products.stock` and `products.size_stock` are compatibility projections that may only be updated inside the same product or inventory database transaction. Preserve one product business operation ID across double clicks, timeouts, response loss, and refreshes so a retry reuses the same idempotency key.


CSV import uses the separate CSV transaction boundary below. Product image upload/deletion and permanent product deletion remain outside this P2 product transaction boundary; do not expand it without their own scoped review, migration, and regression coverage.


\---


\## 16. CSV import transaction and recovery boundary


Formal CSV product import requires both `USE_PRODUCT_RPC=true` and `USE_CSV_IMPORT_RPC=true`. Missing configuration, `20260716100000_transactional_csv_import_jobs.sql`, execute privilege, PostgREST, or RPC availability must fail closed with HTTP 503 before a business write. Never restore direct `products` upserts or the historical best-effort ERP synchronization fallback.


The server is authoritative for UTF-8 CSV parsing and whole-file prevalidation. A normalized duplicate SKU, invalid or ambiguous header, malformed quote structure, invalid field, or resource-limit violation rejects the file before a Job is created. Translation is an optional pre-commit step: the user must see the final translated preview, and the frozen post-translation payload is what receives the fingerprint.


Every import explicitly selects `create_only`, `update_existing`, or `upsert`, plus `metadata_only` or `set_inventory`. `metadata_only` must not alter inventory. `set_inventory` uses stocktake/set-to semantics without implicitly deleting, deactivating, or zeroing omitted existing Variants. `inventory_balances` remains authoritative, and each row's product, Variants, balances, movements, compatibility projections, and result record commit or roll back together.


`product_import_jobs` and `product_import_rows` are service-role-only recovery records with RLS and no anon/authenticated policies. Preserve the file operation ID across double clicks, timeout, response loss, refresh, and login refresh; replaying the same ID and fingerprint returns the original Job, while a changed payload conflicts. Successful rows never rerun; failed rows may be downloaded and explicitly retried. Product CSV export is not a database disaster-recovery backup, and every exported text cell must use the shared spreadsheet-formula neutralization.


The file-level fingerprint must be computed from the raw file hash, explicit modes, and final normalized post-translation payload. Do not include database-derived product IDs or metadata/structure versions: those are row concurrency tokens and change after a successful import. On POST replay, look up the existing Job before recomputing preview tokens. Likewise, `product_import_rows.expected_product_id` must remain an immutable bigint rather than an `ON DELETE SET NULL` foreign key, otherwise deleting and recreating the same SKU can erase the frozen target identity.


A recovery GET returning 401, 403, or 404 does not prove the original POST made no write and must never clear an attempted browser operation ID. CSV runtime health must include the underlying product runtime, active `MAIN_STORE`, and the private authoritative Variant helper before a new Job is created.


CSV fault-injection tests reuse one PL/pgSQL trigger function across tables with different row shapes. Branch on `TG_TABLE_NAME` in separate nested blocks before reading table-specific `NEW` fields; a combined boolean expression can still raise `record "new" has no field ...` on the other table and create a false retry failure.


\---


\## 17. Storage and image lifecycle boundary


All product, Logo, hero, category, and AI styling images use the `product-images` bucket. Public bucket access is read-only for storefront delivery; never add anon/authenticated insert, update, or delete policies. The bucket MIME/size constraints and private recovery tables are installed by `20260716141423_harden_storage_image_lifecycle.sql`; image routes must fail closed when that migration or the server service role is unavailable instead of mutating bucket configuration at runtime.


Accept only JPEG, PNG, or WebP after server-side magic-byte, declared MIME, byte, pixel, dimension, animation/multipage, and Sharp decode validation. Always re-encode accepted input to WebP. Never restore the old raw-file fallback. Managed product paths are scoped by immutable product id plus a collision-resistant SKU segment and random UUID; legacy or external URLs may be detached but must not be automatically deleted across products.


Image writes and deletes must register `storage_object_operations` before Storage mutation, compensate a Storage upload when the database reference fails, and queue failed object deletion for the trusted `storage:recover` CLI. `storage:reconcile` is intentionally read-only. Permanent product deletion is RPC-only, protects all order/inventory/import history and non-zero balances, and records object cleanup in the same database transaction before removing Storage objects.


Server-side reference-image downloads allow only the current customer Storage origin or reviewed exact origins from `SERVER_IMAGE_FETCH_ALLOWED_ORIGINS`. Keep DNS resolution, redirect revalidation, private/metadata/link-local blocking, IP pinning, timeout, response type, Content-Length, and streaming byte limits together; do not replace this with a plain `fetch(url)`.


Standalone install fixtures that create `storage.buckets` must include `file_size_limit bigint` and `allowed_mime_types text[]`, and must use `supabase_storage_admin` for schema-owned setup as documented above.


\---


\## 18. AI and authentication abuse-protection boundary


Shared AI and password-abuse state is installed by `20260716170000_ai_auth_abuse_protection.sql`. Vercel instances must use the database RPCs in `lib/abuse-protection.ts`; never restore a process-local `Map` limiter or silently continue when the shared limiter is unavailable. The migration tables are service-role-only, have RLS enabled with no public policy, and the security-definer RPCs use an empty `search_path` plus explicit revoke/grant.


The public AI assistant requires explicit consent before accepting body measurements. Measurements are request-only data: keep them out of PostgreSQL, browser storage, logs, analytics, and error payloads. Browser product fields are not authoritative; rebuild a bounded provider payload from the server-side public product projection, and constrain model recommendations to SKUs included by the server. Preserve the IP/session/store/global minute limits, daily request budget, concurrency lease, provider timeout, request/output byte limits, and fail-closed behavior.


Emergency environment passwords are optional but, when configured, must be at least 20 characters with letters, numbers, and symbols and must be unique across roles and customers. Validate them during server startup. `AUTH_RATE_LIMIT_SECRET` must be a per-customer server-only random secret of at least 32 characters. Developer login and emergency password failures share the database-backed limiter; never log raw passwords, tokens, measurements, service keys, or pseudonym inputs.


Admin authorization responses follow one matrix: unauthenticated is 401, authenticated but unauthorized is 403, disabled feature is 403 with `FEATURE_DISABLED`, shared security/RPC capability unavailable is 503, and an active rate block is 429. Supabase employee sessions must listen for token refresh and sign-out, refresh the server authorization context, and clear local credentials on logout. An environment owner password never grants a developer-only session.


\---


\## 19. Legacy product image URL column compatibility


The original customer database was observed with `public.products.image_urls` as `text[]`, while the current baseline and transactional product RPC contract use a JSONB string array. That mismatch makes `product_update_rpc` fail closed at runtime with `CASE types text[] and jsonb cannot be matched`; do not bypass the RPC with a direct product update.


`20260719110000_normalize_legacy_product_image_urls.sql` converts the legacy array to JSONB without changing its URLs and enforces the array contract. Keep the legacy product installation fixture exercising this conversion and a metadata-only RPC call. New product migrations and customer upgrades must preserve `image_urls` as a non-null JSONB array.


\---


\## 20. Category catalog transaction boundary


Category create, update, and delete writes are transactional through `public.category_catalog_apply_rpc`, installed by `20260801191232_transactional_category_catalog.sql`. Never restore the previous Route Handler loops that ignored Supabase upsert errors, and never treat removing a row from React state as a database deletion.


New categories and subcategories receive stable client-generated UUIDs before one catalog transaction is submitted, so a new child can safely reference a new parent. Persisted category slugs and persisted subcategory identity `(category_id, slug)` are immutable because products store these slugs as catalog references.


Deleting a category or subcategory that is still used by a product must fail with a clear conflict and roll back every other catalog change in the request. Use `is_active=false` when the merchant only wants to hide an in-use category. Keep the RPC service-role-only with an empty `search_path`, explicit revoke/grant, strict request validation, and fail-closed behavior when the migration or admin client is unavailable.


\---


\## 21. Storefront category source of truth


Enabled `product_categories` and `product_subcategories` rows are the storefront source of truth. Homepage category cards, desktop and mobile navigation, dynamic category routes, product category labels, and sitemap category URLs must all use `getStorefrontCategoryNavigation`; do not reintroduce direct rendering from the fixed `lib/types.ts` fallback list.


The maintained eight-category list is only a read fallback when category data cannot be loaded. More than eight enabled categories must remain reachable: the homepage grid wraps all entries, desktop navigation uses seven direct entries plus a complete More menu, and mobile/tablet navigation keeps every first-level category in the horizontal scroller. Greek and English database names are customer-facing; never fall back to Chinese names on the storefront.


\---


\## 22. Legacy category timestamp compatibility


The pre-release Production database was observed with `public.product_categories` and `public.product_subcategories` missing `updated_at`, even though the baseline migration was present in migration history. The baseline uses `create table if not exists`, so it does not add newer columns to a pre-existing legacy table; the category API then fails when its explicit select includes `updated_at`, and update triggers cannot safely run.


Keep `20260802103000_repair_legacy_category_timestamps.sql` in every existing-customer upgrade. It must create its own `public.set_updated_at()` helper, add and backfill both timestamp columns without changing category data, enforce defaults and non-null constraints, and recreate both triggers. Verify the dedicated legacy category installation fixture as well as the empty migration reset before deploying category-management code.

## 23. Local workflow verification isolation

The mocked admin UI harness and real local database integration tests must not share a Next.js build/cache directory. The mocked Basic feature configuration was observed persisting in `.next/cache`, causing a later inventory role test to return `FEATURE_DISABLED` even after preparing the real local feature row. The UI harness sets `ADMIN_UI_TEST_ISOLATED=1` to use `.next-admin-ui`; the inventory harness sets `ADMIN_INVENTORY_TEST_ISOLATED=1` to use `.next-inventory-test`; normal builds remain `.next`. Do not bypass feature authorization to make tests pass. Run app-launching tests serially and stop only their own child processes. A 404 during overlapping Next dev instances is not proof of a business regression. Next dev may update generated next-env.d.ts and TypeScript includes for these directories; complete a normal build before final validation and do not commit a test-only next-env.d.ts reference.

## 24. Atomic inventory receipt boundary

The main receiving entry uses `public.inventory_receipt_complete_rpc` for one payload-bound multi-Variant transaction. Never replace it with a browser loop over `/api/admin/inventory/adjust`: the receipt header/items, missing internal Barcodes, balances, stock movements, Variant cost updates, and legacy product projections must commit or roll back together. Replays must preserve one browser operation ID and the same payload fingerprint. Receipt reprint uses immutable snapshots and must never change inventory. Existing single-Variant `inventory_apply_rpc` remains the boundary for stocktake, return stock addition, and manual adjustments.

The store-operations plan still describes an eventual batch stocktake workflow but does not assign it an implementation phase; existing stocktake remains single-Variant. Browser `print`/`afterprint`, Preview deployment success, and an operator's local print confirmation are not hardware acceptance evidence. Physical PT-1509/scanner results must be recorded separately before claiming the complete store workflow is accepted.

Local Supabase platform DDL hooks were observed reapplying broad `service_role` grants to an older public table when a later public table was created. Any migration adding public tables after the immutable `barcode_operations` or `audit_logs` ledgers must explicitly restore their existing least-privilege grants at the end and rerun the database security gate; do not assume an earlier revoke remains the final ACL.

## 25. POS partial return and exchange boundary

Formal partial returns and exchanges are RPC-only through `public.pos_return_exchange_rpc`. Keep whole-order POS void as a separate operation; never implement a partial return by weakening or reusing the void path. The original order, prior returned quantities, sellable balance, replacement balance, stock movements, external settlement evidence, actor, and request fingerprint must be checked and written in one transaction. Preserve the browser `clientRequestId` across retry or response loss.

Only `resellable` goods return to `MAIN_STORE`. `damaged` and `quarantine` goods go to their dedicated non-sellable locations and must not raise the storefront stock projection. A non-zero price difference requires an explicit external collection or refund method, reference, confirmation, and exact expected amount; the application does not perform the external payment. The printable result is an internal operational receipt and must state that it is not an AADE tax receipt.

---

## 26. Current online commerce provider boundary

The maintained template uses Viva Smart Checkout for prepaid online orders, with BOX NOW Locker and/or store pickup as fulfillment methods. Earlier documents that describe cash on delivery or payment at pickup are stale and must not be used to revert the current order flow.

Keep provider credentials customer-specific and environment-driven. A new customer should only need its own Viva, BOX NOW, site URL, rate-limit, and cron values plus Store Settings switches; do not hardcode merchant IDs, source codes, origin IDs, Partner IDs, domains, or API hosts into customer business logic.

`VIVA_WEBHOOK_VERIFICATION_KEY` is part of the runtime readiness gate. Checkout success/failure return pages are never payment proof: only a Viva Webhook followed by an authoritative transaction retrieval and Merchant/Source/order/amount/currency/status comparison may confirm payment. BOX NOW shipment creation remains prepaid and must never silently enable carrier COD.

Use `npm run commerce:status` to inspect configuration without exposing values, `npm run commerce:verify -- --provider viva|boxnow|all` for authentication-only provider checks, and `npm run test:online-orders-runtime` for the local application/database readiness check. Provider verification must not create payments, orders, parcels, or labels.

\---

\## 27. User-facing copy boundary

Customer and employee interfaces must stay task-focused. Show what the user can do, what information is needed, the current result, and the next safe action.

Do not expose implementation plans, phases, test or acceptance notes, architecture, database/RPC/migration terminology, provider setup commentary, internal Job or operation identifiers, or agent/development instructions in visible UI, accessibility text, metadata, or collapsed content. Keep those details in developer documentation and logs. Translate recoverable failures into plain operational guidance without weakening fail-closed behavior, idempotency, permissions, or audit records.

