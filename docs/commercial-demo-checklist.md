# v1.0 Commercial Demo Checklist

This checklist is for the clothing store commercial demo version.

## Current Version Boundary

Production status at the time of this checklist:

- Production Supabase ref: `rgkdyksyztqaupatiltz`
- Latest production deployment commit checked: `074972ce69ce7b6b422772b5430b4afd9aec311d`
- `USE_POS_RPC=true`
- `USE_VARIANT_INVENTORY=false` or unset
- Public storefront and online ordering read the maintained product and Variant inventory projections.

## Local Build Checks

Run before a commercial demo:

```bash
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected result:

- TypeScript passes.
- Production build passes.
- `git diff --check` has no whitespace errors.
- Working tree is clean, unless intentionally preparing a new commit.

## Production Smoke Checks

Open these pages before a demo:

| Area | URL / Action | Expected Result |
| --- | --- | --- |
| Home | `/` | Returns 200, no white screen, images load |
| Category | `/women` or `/shoes` | Returns 200, product list loads |
| Product detail | Any real `/product/[sku]` | Returns 200, product image, price, stock, buttons load |
| Admin | `/admin` | Login page opens |
| Inventory tab | Admin -> Inventory | List loads, reconciliation status visible |
| POS checkout tab | Admin -> POS checkout | Search and cart UI loads |
| POS orders tab | Admin -> POS orders | Order history UI loads |
| Label printing | Admin -> Label printing | Variant list and print controls load |
| Cart | `/cart` | Renders the shopping-cart page |
| Sitemap | `/sitemap.xml` | Returns `application/xml` |
| Unauthorized API | Admin API without password | Returns 401 |

## ERP Reconciliation Checks

All of these should be `0`:

- `stock_vs_balance_mismatch`
- `size_stock_vs_erp_mismatch`
- `products_without_variants`
- `variants_without_MAIN_STORE_balance`
- `duplicate_variant_sku`
- `duplicate_barcode`
- `reserved_exceeds_on_hand`
- `movement_reason_blank`

Latest checked result:

```txt
products: 28
variants: 34
balances: 34
stock_movements: 38
ERP checks: all 0
```

## POS Runtime Health Checks

All of these should be `0`:

- Completed orders without payment
- Completed orders without items
- Completed orders without `sale / pos_sale` movement
- Voided orders without `return / pos_void` movement
- Payment status mismatch
- Order item quantity <= 0
- Order total vs item total mismatch
- Negative inventory balance
- Duplicate sales order idempotency key
- Duplicate stock movement idempotency key
- Voided orders still marked payment paid

Latest checked result:

```txt
orders: 2
order_items: 2
payments: 2
POS checks: all 0
```

## Production Environment Checks

Production Vercel should contain:

- `NEXT_PUBLIC_SUPABASE_URL` pointing to `rgkdyksyztqaupatiltz`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `USE_POS_RPC=true`
- No `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`

Preview environment, if used for testing, should point to test Supabase:

- Test ref: `krlhwwjkgoqzusehxuav`
- Preview service role key must be the test project key, not production.

Git safety:

- `backups/`
- `backups/*.sql`

must remain ignored and must not be committed.

## Completed Features

- Storefront home page
- Category pages
- Product detail pages
- Admin product management
- Image upload
- CSV import
- Online shopping and online-order management
- ERP inventory tables
- Inventory management tab
- Manual inventory adjustment
- Inventory movements
- POS checkout
- POS order history
- POS order details
- POS void
- POS RPC transaction path
- Receipt preview and browser print
- Barcode generation API
- Browser-based label printing UI

## Deferred Features

Do not present these as completed:

- myDATA / tax invoice integration
- Electronic invoice provider integration
- ESC/POS local print bridge
- Printer SDK integration
- Real label printer hardware validation
- Employee role permissions
- Complex refund / partial return
- Supplier purchasing
- Multi-location / multi-store inventory
- Multi-location online-order routing

## Demo Day Checklist

1. Confirm latest production deployment is ready.
2. Open storefront home page.
3. Open one category page.
4. Open one product detail page.
5. Open `/cart` and `/checkout`.
6. Login to `/admin`.
7. Show product list.
8. Show inventory tab and reconciliation status.
9. Show POS checkout tab.
10. Show POS order history.
11. Open an order detail.
12. Open receipt preview.
13. Show label printing tab.
14. Generate barcode only on a test variant if needed.
15. Use dryRun for POS demonstrations unless a real test sale is intended.
16. Do not demonstrate myDATA, tax invoice, ESC/POS, or real hardware printing unless separately validated.

## Rollback Notes

If POS RPC has a production issue:

1. Pause POS checkout and void operations.
2. Set `USE_POS_RPC=false` only if an API-level emergency block is required, then redeploy.
3. Run ERP and POS health checks and preserve the affected request IDs.
4. Repair or roll forward the RPC migration before setting `USE_POS_RPC=true` again.
5. Do not enable the historical Supabase JS multi-step fallback.
