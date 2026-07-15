# P2 4B CSV transaction semantics

This document freezes the observed pre-4B behavior and the target contract before implementation. It is an engineering boundary, not a claim that CSV import is already hardened.

## Confirmed current flow

```text
Browser File.text()
  -> custom client CSV parser and aliases
  -> client-only preview checks
  -> one unbounded JSON request containing every row
  -> products:write and csv_import checks
  -> lenient server product validation
  -> DeepSeek translation during the commit request
  -> implicit products upsert (last normalized duplicate wins)
  -> per-product Node.js legacy/ERP synchronization
  -> cache invalidation
  -> unbounded in-memory row results
```

The product upsert and the later Variant, inventory balance, stock movement, and legacy projection writes are separate operations. A product can therefore be committed while its inventory synchronization fails, yet the row is still reported as successful. This is the original P2 4B regression that the implementation and integration tests must prove is removed.

## Current matrix

| Stage | Current input and output | Trust and limits | Transaction and retry behavior | Confirmed failure mode |
| --- | --- | --- | --- | --- |
| File selection | Browser `File` to full text | `.csv` accept hint only; no byte limit | No durable identity | Whole file is loaded into browser memory |
| Browser parser | CSV text to row objects | Does not reject unclosed quotes, duplicate/unknown headers, extra columns, long cells, or excessive rows | No stable operation ID | Browser preview is treated as the parser of record |
| Header aliases | Exact header to internal field | Case-sensitive; duplicate aliases overwrite | Server cannot revalidate original structure | Ambiguous column mapping is silently accepted |
| Preview validation | Row object to error list | Empty numeric values can become zero; inventory range and integer rules are incomplete | UI state only | Preview and server behavior disagree |
| HTTP request | All rows to one JSON body | No body, row, column, cell, or result limit | Network loss leaves no queryable state | User can only repeat an uncertain import |
| Server validation | Row object to product mutation | Lenient parsing can truncate or discard invalid values | No file-level all-or-nothing validation | Partially invalid `size_stock` and procurement values are silently accepted |
| Translation | Mutations to translated mutations | External request has no bounded import-level timeout/cost | Replayed import translates again | Final write payload is not stable across retries |
| Duplicate SKU handling | Valid rows to last-row-wins set | Uses trim plus uppercase, unlike the database's lower/btrim contract | Earlier duplicate is marked successful | Success count exceeds actual writes |
| Product write | Mutations to `products` upsert | Service-role direct table write | Product batch is atomic, complete business row is not | Bypasses 4A RPC, operation IDs, versions, and fail-closed behavior |
| ERP/Variant sync | Product IDs to variants/balances/movements | Node.js multi-step writes | Cannot roll back the product or earlier inventory writes | A row can be reported successful with missing Variant, balance, or movement |
| Inventory semantics | `stock`/`size_stock` to legacy targets | No explicit metadata-only versus set-inventory mode | Missing sizes may be treated as stale | Existing sizes can be stopped or zeroed implicitly; reserved inventory can be reduced |
| Cache invalidation | Any apparent success to revalidation | Not tied to durable job completion | Failure does not affect database result | A cache error can encourage an unsafe re-import |
| Result response | In-memory rows to HTTP 200 | Full raw result and ERP messages | Not recoverable after refresh | Large responses and internal database errors can reach the browser |
| Product export | All product/variant queries to CSV | Relies on implicit Supabase row cap and ignores query errors | A failed/truncated query can still return 200 | Partial export can look complete; formulas are executable in spreadsheets |

## Target file-level contract

The file must be completely and strictly prevalidated before any business write. Header ambiguity, malformed CSV structure, invalid UTF-8, normalized duplicate SKU, or a resource-limit violation rejects the whole file and creates no import job or product write.

After prevalidation, rows execute independently. Partial file success is allowed and is reported explicitly, but a business row is atomic: its product metadata, Variants, `inventory_balances`, `stock_movements`, legacy `products.stock`/`products.size_stock` projection, and durable row result either all commit or all roll back.

The initial safety limits are:

- UTF-8 CSV only, with an optional UTF-8 BOM.
- Maximum file/request payload: 1 MiB.
- Maximum data rows: 500.
- Maximum columns: 100.
- Maximum decoded cell length: 32 KiB.
- Maximum logical row length: 128 KiB.
- Maximum image URL entries: 20.
- Maximum sizes/Variants per row: 100.
- Maximum JSON depth: 8 and maximum JSON collection entries: 500.

These limits fit the small physical-store workflow and keep validation and responses within a serverless request budget. Larger imports must be split into multiple files rather than attempted until timeout.

## Explicit import modes

### Product mode

- `create_only` is the default. An existing normalized SKU fails that row and is not changed.
- `update_existing` requires the SKU to exist. A missing SKU fails that row and no product is created.
- `upsert` is available only after explicit user selection and confirmation. It never uses a direct table upsert; it dispatches to the transactional create or update path.

### Inventory mode

- `metadata_only` does not read or rewrite inventory. Inventory columns are rejected when populated so the user cannot assume that they were applied.
- `set_inventory` must be selected explicitly. Quantities have stocktake/set-to semantics and are written through the product transaction boundary. On an existing product, CSV sizes are merged into the complete authoritative active Variant snapshot, so sizes omitted from the CSV are preserved unchanged. The import may add a Variant but may not implicitly deactivate, delete, or zero an omitted Variant.
- A requested on-hand quantity below reserved inventory is a row conflict, not an instruction to reduce the reservation.
- With `size_stock`, product stock is derived from the exact size quantities. A contradictory `stock` value is rejected. ONE SIZE creates only the `ONE SIZE` Variant.

## Strict parsing contract

- The server parses the original CSV bytes and is authoritative; browser parsing is only a convenience.
- Header matching is case-insensitive and supports documented aliases. Duplicate headers after alias normalization, unknown headers, missing required headers, and extra data columns are file-level errors.
- SKU identity uses `lower(btrim(sku))`. A normalized duplicate anywhere in the file is a file-level error.
- Numeric fields must consume the complete string and obey range/integer rules. Currency signs, formulas, `NaN`, infinity, negative inventory, and fractional inventory are rejected.
- Boolean fields accept only `true/false`, `1/0`, and `yes/no`, case-insensitively.
- `size_stock` and Variant procurement maps must consume every token. Duplicate/empty sizes, malformed separators, invalid quantities, and size-list conflicts fail the row.
- `size_chart`, `ai_keywords`, `style_tags`, and `image_urls` are parsed against bounded schemas. Invalid JSON is never ignored.

## Translation boundary

Translation is an optional preprocessing request after strict validation and before commit. The translated fields are visible in the final preview. Commit never calls an external AI provider. The frozen, translated payload is what is fingerprinted and persisted; network retries reuse exactly that payload and never translate again. Translation timeout, failure, or missing configuration performs no database write.

## Durable job and idempotency contract

- `product_import_jobs` stores the file operation ID, final payload fingerprint, filename, selected modes, counts, status, actor, timestamps, and bounded summary.
- `product_import_rows` stores a unique row operation ID, row and payload fingerprints, normalized SKU, status, result identifiers, retry metadata, and a safe error code/summary.
- The same file operation ID plus the same fingerprint returns the existing job. The same operation ID plus different content returns `409 CSV_IMPORT_OPERATION_CONFLICT`.
- Each successful row is immutable for retry purposes. A failed retryable row can be retried explicitly with the same row identity.
- A response loss is recovered by querying the job with the original operation ID. Page refresh and login refresh do not require a second import.
- Job status is derived from persisted rows (`pending`, `running`, `completed`, `partial`, or `failed`) and can be reconciled if summary maintenance fails.
- Raw SQL errors, stack traces, credentials, and provider responses are never stored in or returned from job results.

## Export contract

Product export is a product-data export, not a database disaster-recovery backup. Products and Variants are paged, query errors abort with 5xx, returned counts are checked, and Variant grouping uses a `Map`. Any failed/truncated page produces no plausible partial CSV. Responses use `Cache-Control: no-store`.

Every text cell written to product exports, failed-row downloads, or import-error reports uses the same spreadsheet-formula neutralization. After optional leading whitespace, values beginning with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed with a single quote before normal RFC-style CSV escaping. Valid numeric fields remain numeric.

## Authorization and fail-closed contract

- Import requires `products:write` and the `csv_import` Feature.
- Export requires `backup:read` and the `backup_tools` Feature.
- Unauthenticated requests return 401; authenticated-but-insufficient roles return 403; disabled Features return 403 with `FEATURE_DISABLED`.
- Job tables have RLS enabled and no anon/authenticated table access or policy. Only service-role server code and service-role-only SECURITY DEFINER RPCs can operate them.
- Missing configuration, migration, execute privilege, or RPC availability returns 503 before a business write. There is no direct-table or Node.js multi-step fallback.

