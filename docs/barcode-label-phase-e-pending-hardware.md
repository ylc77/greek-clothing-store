# Barcode & Label Phase E - Pending Hardware Validation

## Current Status

Barcode & Label Phase E cannot complete real hardware acceptance yet because there is currently no real thermal label printer or barcode scanner available for testing.

Hardware validation status: **Pending**

## Software-Side Checks Available Now

The following items can be verified without physical hardware:

- Label preview can open in `/admin`.
- Label size can switch between:
  - `40x30mm`
  - `50x30mm`
  - `60x40mm`
- Browser print preview can open.
- Browser print output can be saved as PDF.
- Barcode SVG can render in the label preview.
- First version barcode rule is:
  - `barcode = variant_sku`
- POS search supports:
  - barcode
  - variant SKU
  - product SKU
  - product name
- POS can theoretically find products by generated barcode / variant SKU.

## Hardware Items Not Confirmed Yet

The following items cannot be confirmed until real devices are available:

- Real label paper print clarity.
- Whether a real barcode scanner can scan the printed barcode reliably.
- Whether browser printing creates extra blank labels or blank pages.
- Whether label position shifts on real paper.
- Whether the label printer driver supports the chosen paper sizes.
- Whether `40x30mm`, `50x30mm`, or `60x40mm` is the best physical label size for clothing tags.
- Whether staff can comfortably use the browser print workflow.

## Hardware Validation To Do Later

When real devices are available, test these items:

1. Print a `50x30mm` label.
2. Print a `60x40mm` label.
3. Check whether the barcode is clear.
4. Scan the label with a real barcode scanner.
5. Confirm the scanned value equals the barcode / variant SKU.
6. Open POS checkout.
7. Scan the label into POS search.
8. Confirm POS finds the correct variant.
9. Run POS dryRun.
10. Confirm product, price, and stock are correct.
11. Check whether there are blank labels or blank pages.
12. Check whether paper alignment is acceptable.

## Conclusion

Do **not** develop ESC/POS, printer SDK, or a local print bridge yet.

The current browser-based label printing flow should remain the first version until real printer and scanner testing proves that it is not stable enough.

Next decision point:

- If browser printing works well on real hardware, keep the current solution.
- If browser printing has alignment, blank page, scanner, or driver issues, then design the next phase for printer SDK / ESC/POS / local print bridge.
