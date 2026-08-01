export const FIXED_PRODUCT_VAT_RATE = 24;

export function isFixedProductVat(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (normalized === "") return true;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed === FIXED_PRODUCT_VAT_RATE;
}
