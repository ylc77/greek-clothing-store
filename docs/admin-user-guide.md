# Admin User Guide

This is a draft guide for using the clothing store admin system in the v1.0 commercial demo version.

## Login

1. Open `/admin`.
2. Enter the admin password.
3. After login, the dashboard shows product count, active products, stock warnings, and common actions.

Security notes:

- Do not share the admin password publicly.
- Do not put the service role key in browser code or any `NEXT_PUBLIC_` environment variable.

## Add A Product

1. Open `新增/编辑`.
2. Fill in:
   - SKU
   - Category
   - Subcategory
   - Price
   - Product names and descriptions
   - Images
   - Size stock
3. Save the product.
4. After saving, the system keeps legacy stock and ERP inventory in sync.

Notes:

- Total stock is calculated from size stock.
- For clothing and shoes, fill stock by size.
- For one-size categories, use `ONE SIZE`.

## Edit A Product

1. Open `商品列表`.
2. Click edit on a product.
3. Update product information.
4. Save.

Important:

- Products with inventory movements cannot freely change SKU.
- Use down listing instead of permanent deletion for real products with inventory history.

## Upload Images

1. Open the product editor.
2. Upload the main image and extra images.
3. Save the product.
4. Check storefront product card and detail page.

Tips:

- Use clear product photos.
- For Skroutz, use public image URLs and sufficient image size.

## Manage Inventory

Open `库存管理`.

You can:

- Search product name, SKU, variant SKU, or barcode.
- Filter by stock status.
- View quantity on hand, reserved quantity, and available quantity.
- View reconciliation status.
- Open the manual inventory adjustment dialog.

## Manual Inventory Adjustment

1. Open `库存管理`.
2. Select a variant.
3. Click adjust inventory.
4. Choose:
   - Set to a specific quantity
   - Adjust by a positive or negative amount
5. Enter a reason.
6. Submit.

Rules:

- Reason is required.
- Stock cannot become negative.
- The adjustment writes an inventory movement.
- Legacy `products.stock` and `products.size_stock` are synced after adjustment.

## View Inventory Movements

Open `库存管理` and review recent movements.

Movement examples:

- `initial_migration`
- `manual_adjustment`
- `sale`
- `return`
- `correction`

Use movements to understand why stock changed.

## Generate Barcode

Open `标签打印`.

1. Search or filter variants.
2. Select variants with missing barcode.
3. Click generate selected barcode.

Current barcode rule:

```txt
barcode = variant_sku
```

Rules:

- Existing barcode is not overwritten.
- Barcode must be unique.
- Variants with inventory or sales history are protected by the barcode API.

## Print Labels

Open `标签打印`.

1. Select variants.
2. Choose label size:
   - `40x30mm`
   - `50x30mm`
   - `60x40mm`
3. Click print selected labels.
4. Confirm barcode SVG appears.
5. Use browser print.

Current limitation:

- Real label printer hardware validation is pending.
- Do not build ESC/POS or printer SDK integration until real device testing confirms browser printing is not enough.

## POS Checkout

Open `POS 收银`.

1. Search by barcode, variant SKU, product SKU, or product name.
2. Add product to cart.
3. Adjust quantity.
4. Choose payment method:
   - cash
   - card
   - other
5. Run dryRun / pre-check.
6. Complete checkout.

Checkout result:

- Creates sales order.
- Creates order items.
- Creates payment record.
- Deducts ERP inventory.
- Writes `sale / pos_sale` stock movement.
- Syncs legacy product stock.

## Void A POS Order

Open `POS 订单`.

1. Find the order.
2. Open order detail.
3. Click void if the order is completed.
4. Enter a reason.
5. Confirm.

Void result:

- Marks order as voided.
- Marks payment as voided.
- Adds stock back.
- Writes `return / pos_void` stock movement.
- Syncs legacy product stock.

Important:

- Void is not the same as refund.
- Complex refunds and partial returns are deferred.
- Future tax invoice integration may require provider-side void/refund flow.

## Print Receipt

Receipt preview is available after checkout and in order detail.

1. Open a completed or voided order.
2. Click receipt preview / print.
3. Use browser print.

Receipt notes:

- The receipt is not a tax invoice.
- myDATA / invoice QR / MARK are not implemented yet.

## CSV Import

Open `CSV 导入`.

1. Download or prepare a CSV template.
2. Upload it and complete server-side preflight validation.
3. Choose `create_only`, `update_existing`, or explicitly confirmed `upsert`.
4. Choose `metadata_only` (no inventory changes) or `set_inventory` (stocktake/set-to semantics).
5. Optionally translate, review the final translated preview, and then commit.
6. Review the persistent Job result. After a refresh or network interruption, recover the same Job instead of starting a duplicate import.
7. Download failed rows and retry only those rows when appropriate.

Current small-store safety limits are 1 MiB per CSV, 500 data rows, 100 columns, 32 KiB per cell, 20 image URLs, and 100 sizes per product. Files beyond a limit are rejected before a Job is created; split them into smaller files instead of repeatedly retrying an oversized request.

After import:

- Every successful row has committed its product, Variants, inventory, movements, compatibility projections, and result atomically.
- Failed rows are not reported as successful and do not leave partial product/inventory writes.
- `metadata_only` never changes inventory; `set_inventory` must be selected deliberately.
- Product CSV export is a product-data export, not a complete database backup.

## Check Skroutz Feed

Open `Skroutz Feed`.

1. Copy `/feed.xml`.
2. Open the feed in a browser.
3. Confirm it returns XML.
4. Check products have:
   - SKU
   - Name
   - Price
   - Stock
   - Public image URL
   - Product URL

Notes:

- Feed still reads legacy `products.stock` and `products.size_stock`.
- ERP sync keeps these fields accurate.

## Demo Safety Rules

- Use dryRun before any real POS checkout.
- Use test products for checkout and void demonstrations.
- Do not demonstrate tax invoice / myDATA as completed.
- Do not modify production database manually during demo.
- Do not expose Supabase service role key.
- Keep `USE_POS_RPC=true` unless rollback is needed.
- Keep `USE_VARIANT_INVENTORY=false` for v1.0.
