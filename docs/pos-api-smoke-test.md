# POS API smoke test

This smoke test is for local or staging verification. It must not be used to run a real production checkout unless the operator intentionally removes `dryRun: true`.

## 1. Search without password

Expected result: `401 Unauthorized`.

```powershell
Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:3000/api/admin/pos/search?q=TEST"
```

## 2. Search with admin password

Expected result: a JSON response with `ok: true` and an `items` array. Pick one `variant_id` with enough `quantity_available` for the dry-run checkout.

```powershell
$headers = @{ "x-admin-password" = $env:ADMIN_PASSWORD }

Invoke-RestMethod `
  -Method GET `
  -Headers $headers `
  -Uri "http://localhost:3000/api/admin/pos/search?q=SKU_OR_BARCODE"
```

## 3. Dry-run checkout

Expected result: `ok: true`, `dryRun: true`, totals, item preview, and `stockCheck.ok: true`.

This does not create `sales_orders`, `sales_order_items`, `payments`, `stock_movements`, or update inventory.

```powershell
$headers = @{
  "x-admin-password" = $env:ADMIN_PASSWORD
  "Content-Type" = "application/json"
}

$body = @{
  clientRequestId = [guid]::NewGuid().ToString()
  paymentMethod = "cash"
  dryRun = $true
  items = @(
    @{
      variantId = "PASTE_VARIANT_ID"
      quantity = 1
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method POST `
  -Headers $headers `
  -Uri "http://localhost:3000/api/admin/pos/checkout" `
  -Body $body
```

## 4. Inventory reconciliation

After dry-run testing, ERP reconciliation should still return no issues because no data was written.
