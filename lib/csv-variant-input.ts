export type CsvVariantInput = {
  id?: string;
  variant_sku: string;
  barcode?: string | null;
  size: string;
  color?: string;
  quantity: number;
  expected_on_hand?: number;
  price: number;
  cost_price?: number | null;
  supplier_id?: string | null;
  supplier_sku?: string;
  reorder_level?: number | null;
  active: true;
  sort_order: number;
};

type BuildCsvVariantInputsOptions = {
  headers: ReadonlySet<string>;
  sku: string;
  price: number;
  color: string;
  supplierId: string | null;
  quantities: Readonly<Record<string, number>>;
  supplierSkus: ReadonlyMap<string, string>;
  costPrices: ReadonlyMap<string, number>;
  reorderLevels: ReadonlyMap<string, number>;
};

function slug(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "ONE-SIZE";
}

export function buildCsvVariantInputs(options: BuildCsvVariantInputsOptions): CsvVariantInput[] {
  return Object.keys(options.quantities).map((size, index) => {
    const variant: CsvVariantInput = {
      variant_sku: `${options.sku}-${slug(size)}`,
      size,
      quantity: options.quantities[size]!,
      price: options.price,
      active: true,
      sort_order: index,
    };
    // Presence is significant: omitted means preserve an existing value,
    // while an explicitly supplied blank column means clear it.
    if (options.headers.has("color")) variant.color = options.color;
    if (options.headers.has("supplier_id")) variant.supplier_id = options.supplierId;
    if (options.headers.has("variant_supplier_skus")) {
      variant.supplier_sku = options.supplierSkus.get(size) ?? "";
    }
    if (options.headers.has("variant_cost_prices")) {
      variant.cost_price = options.costPrices.get(size) ?? null;
    }
    if (options.headers.has("variant_reorder_levels")) {
      variant.reorder_level = options.reorderLevels.get(size) ?? null;
    }
    return variant;
  });
}
