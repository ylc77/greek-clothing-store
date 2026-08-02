export type ProductVariantMatrixRow = {
  id?: string;
  variantSku?: string;
  barcode?: string;
  size: string;
  color: string;
  quantity: number;
  expectedOnHand?: number;
  quantityReserved?: number;
  price?: number | null;
  costPrice?: number | null;
  supplierId?: string | null;
  supplierSku?: string;
  reorderLevel?: number | null;
  active?: boolean;
  sortOrder?: number;
};

export type PublicProductVariant = {
  size: string;
  color: string;
  quantityAvailable: number;
  unitPrice: number | null;
};

function finiteNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function normalizeVariantSize(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || "ONE SIZE";
}

export function normalizeVariantColor(value: unknown) {
  return String(value || "").trim();
}

export function variantCatalogKey(size: unknown, color: unknown) {
  return `${normalizeVariantSize(size)}\u0000${normalizeVariantColor(color).toLocaleLowerCase()}`;
}

export function variantProcurementKey(size: unknown, color: unknown) {
  return variantCatalogKey(size, color);
}

export function matrixTotal(rows: ProductVariantMatrixRow[]) {
  return rows.reduce((sum, row) => sum + finiteNonNegativeInteger(row.quantity), 0);
}

export function matrixSizeStock(rows: ProductVariantMatrixRow[]) {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.active === false) continue;
    const size = normalizeVariantSize(row.size);
    result[size] = (result[size] || 0) + finiteNonNegativeInteger(row.quantity);
  }
  return result;
}

export function matrixSizes(rows: ProductVariantMatrixRow[]) {
  return Array.from(new Set(rows.filter(row => row.active !== false).map(row => normalizeVariantSize(row.size))));
}

export function matrixColors(rows: ProductVariantMatrixRow[]) {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const row of rows) {
    if (row.active === false) continue;
    const color = normalizeVariantColor(row.color);
    const key = color.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push(color);
  }
  return colors;
}

export function matrixRowsFromVariants(
  variants: Array<{
    id?: unknown;
    variant_sku?: unknown;
    barcode?: unknown;
    size?: unknown;
    color?: unknown;
    quantity_on_hand?: unknown;
    quantity_reserved?: unknown;
    price?: unknown;
    cost_price?: unknown;
    supplier_id?: unknown;
    supplier_sku?: unknown;
    reorder_level?: unknown;
    active?: unknown;
    sort_order?: unknown;
  }>,
) {
  return variants
    .filter(variant => variant.active !== false)
    .map((variant, index): ProductVariantMatrixRow => ({
      ...(typeof variant.id === "string" && variant.id ? { id: variant.id } : {}),
      variantSku: String(variant.variant_sku || "").trim(),
      barcode: String(variant.barcode || "").trim(),
      size: normalizeVariantSize(variant.size),
      color: normalizeVariantColor(variant.color),
      quantity: finiteNonNegativeInteger(variant.quantity_on_hand),
      expectedOnHand: finiteNonNegativeInteger(variant.quantity_on_hand),
      quantityReserved: finiteNonNegativeInteger(variant.quantity_reserved),
      price: variant.price === null || variant.price === undefined ? null : Number(variant.price),
      costPrice: variant.cost_price === null || variant.cost_price === undefined ? null : Number(variant.cost_price),
      supplierId: typeof variant.supplier_id === "string" && variant.supplier_id ? variant.supplier_id : null,
      supplierSku: String(variant.supplier_sku || ""),
      reorderLevel: variant.reorder_level === null || variant.reorder_level === undefined
        ? null
        : finiteNonNegativeInteger(variant.reorder_level),
      active: true,
      sortOrder: finiteNonNegativeInteger(variant.sort_order ?? index),
    }));
}

function skuToken(value: string) {
  return value
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortStableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

/**
 * Variant SKU remains the store's stable internal Barcode source. Existing
 * rows keep their immutable SKU; only newly-added rows use this builder.
 */
export function buildVariantSku(productSku: string, size: unknown, color: unknown) {
  const base = productSku.trim();
  const normalizedSize = normalizeVariantSize(size);
  const normalizedColor = normalizeVariantColor(color);
  const sizePart = skuToken(normalizedSize);
  const colorPart = normalizedColor
    ? skuToken(normalizedColor) || `COLOR-${shortStableHash(normalizedColor.toLocaleLowerCase())}`
    : "";
  const parts = [base, colorPart, sizePart === "ONE-SIZE" ? "" : sizePart].filter(Boolean);
  return parts.join("-");
}

export function publicVariantOptions(value: unknown): PublicProductVariant[] {
  if (!Array.isArray(value)) return [];
  const rows: PublicProductVariant[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const size = normalizeVariantSize(record.size);
    const color = normalizeVariantColor(record.color);
    const key = variantCatalogKey(size, color);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      size,
      color,
      quantityAvailable: finiteNonNegativeInteger(record.quantity_available ?? record.quantityAvailable),
      unitPrice: Number.isFinite(Number(record.price ?? record.unitPrice))
        ? Math.max(0, Math.round(Number(record.price ?? record.unitPrice) * 100) / 100)
        : null,
    });
  }
  return rows;
}

export function sizeOptionsForColor(variants: PublicProductVariant[], selectedColor: string) {
  const normalizedColor = normalizeVariantColor(selectedColor).toLocaleLowerCase();
  return variants
    .filter(variant => normalizeVariantColor(variant.color).toLocaleLowerCase() === normalizedColor)
    .map(variant => ({
      label: normalizeVariantSize(variant.size),
      quantity: finiteNonNegativeInteger(variant.quantityAvailable),
      disabled: finiteNonNegativeInteger(variant.quantityAvailable) <= 0,
    }));
}
