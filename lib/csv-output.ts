export const PRODUCT_CSV_FIELDS = [
  "sku",
  "name_cn",
  "description_cn",
  "name_en",
  "description_en",
  "name_gr",
  "description_gr",
  "category",
  "subcategory",
  "price",
  "stock",
  "sizes",
  "size_system",
  "size_stock",
  "variant_supplier_skus",
  "variant_cost_prices",
  "variant_reorder_levels",
  "image_url",
  "image_urls",
  "brand",
  "supplier_id",
  "supplier_style_code",
  "barcode",
  "ean",
  "mpn",
  "vat",
  "color",
  "skroutz_url",
  "is_active",
  "material",
  "fiber_composition_gr",
  "fiber_composition_en",
  "care_instructions_gr",
  "care_instructions_en",
  "country_of_origin",
  "manufacturer_name",
  "manufacturer_contact",
  "eu_responsible_person",
  "product_safety_notes_gr",
  "product_safety_notes_en",
  "fit_type",
  "ai_keywords",
  "style_tags",
  "size_chart",
  "material_verified",
] as const;

type CsvExportPage<T> = {
  data: T[] | null;
  count: number | null;
  error: { code?: string; message?: string } | null;
};

type CsvProduct = Record<string, unknown> & { id: string | number };

type CsvVariant = Record<string, unknown> & {
  product_id: string | number;
  size?: string | null;
  supplier_sku?: string | null;
  cost_price?: number | string | null;
  reorder_level?: number | string | null;
};

export class CsvExportError extends Error {
  readonly code: "CSV_EXPORT_PAGE_FAILED" | "CSV_EXPORT_COUNT_MISMATCH";

  constructor(code: CsvExportError["code"], message: string) {
    super(message);
    this.name = "CsvExportError";
    this.code = code;
  }
}

function normalizedProductId(value: unknown) {
  const text = String(value ?? "").trim();
  if (/^[0-9]+$/.test(text)) {
    try {
      return BigInt(text).toString();
    } catch {
      // Fall through to the original string. The database query remains the
      // source of truth and this function must not truncate bigint IDs.
    }
  }
  return text;
}

export function groupVariantsByProductId<T extends { product_id: unknown }>(variants: T[]) {
  const grouped = new Map<string, T[]>();
  for (const variant of variants) {
    const key = normalizedProductId(variant.product_id);
    const current = grouped.get(key);
    if (current) current.push(variant);
    else grouped.set(key, [variant]);
  }
  return grouped;
}

export function neutralizeSpreadsheetFormula(value: string) {
  if (/^[\t\r]/.test(value) || /^[ \t\r]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export const neutralizeCsvFormula = neutralizeSpreadsheetFormula;

export function csvTextCell(value: unknown) {
  const text = neutralizeSpreadsheetFormula(String(value ?? ""));
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvCell(value: string | number | boolean | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `"${String(value)}"`;
  }
  if (typeof value === "boolean") return `"${value ? "true" : "false"}"`;
  return csvTextCell(value);
}

export function serializeCsv(
  headers: Array<string | number | boolean>,
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  return [headers, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n") + "\r\n";
}

function stableObjectText(value: Record<string, unknown>) {
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${key}:${String(item ?? "")}`)
    .join(",");
}

export function productCsvValue(field: string, value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (["image_urls", "ai_keywords", "style_tags"].includes(field)) {
      return JSON.stringify(value);
    }
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(",");
  }
  if (typeof value === "object") {
    if (field === "size_chart") return JSON.stringify(value);
    return stableObjectText(value as Record<string, unknown>);
  }
  return String(value);
}

function variantVirtualFields(variants: CsvVariant[]) {
  const supplierSkus: Record<string, unknown> = {};
  const costPrices: Record<string, unknown> = {};
  const reorderLevels: Record<string, unknown> = {};

  for (const variant of variants) {
    const size = String(variant.size || "ONE SIZE").trim().toUpperCase();
    if (variant.supplier_sku !== null && variant.supplier_sku !== undefined && String(variant.supplier_sku).trim()) {
      supplierSkus[size] = variant.supplier_sku;
    }
    if (variant.cost_price !== null && variant.cost_price !== undefined && String(variant.cost_price) !== "") {
      costPrices[size] = variant.cost_price;
    }
    if (variant.reorder_level !== null && variant.reorder_level !== undefined && String(variant.reorder_level) !== "") {
      reorderLevels[size] = variant.reorder_level;
    }
  }

  return {
    variant_supplier_skus: supplierSkus,
    variant_cost_prices: costPrices,
    variant_reorder_levels: reorderLevels,
  };
}

async function fetchEveryPage<T>(
  entity: "products" | "variants",
  pageSize: number,
  fetchPage: (from: number, to: number) => Promise<CsvExportPage<T>>,
) {
  const rows: T[] = [];
  let expectedCount: number | null = null;

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error || !Array.isArray(page.data)) {
      throw new CsvExportError(
        "CSV_EXPORT_PAGE_FAILED",
        `${entity} export page could not be loaded`,
      );
    }
    if (!Number.isSafeInteger(page.count) || Number(page.count) < 0) {
      throw new CsvExportError(
        "CSV_EXPORT_COUNT_MISMATCH",
        `${entity} export did not return a trustworthy total`,
      );
    }
    if (expectedCount === null) expectedCount = Number(page.count);
    if (Number(page.count) !== expectedCount) {
      throw new CsvExportError(
        "CSV_EXPORT_COUNT_MISMATCH",
        `${entity} export total changed between pages`,
      );
    }

    rows.push(...page.data);
    if (rows.length >= expectedCount) break;
    if (page.data.length === 0 || page.data.length > pageSize) {
      throw new CsvExportError(
        "CSV_EXPORT_COUNT_MISMATCH",
        `${entity} export stopped before the reported total`,
      );
    }
  }

  if (rows.length !== expectedCount) {
    throw new CsvExportError(
      "CSV_EXPORT_COUNT_MISMATCH",
      `${entity} export returned ${rows.length} rows but reported ${expectedCount}`,
    );
  }
  return rows;
}

type BuildProductCsvExportOptions = {
  pageSize?: number;
  fetchProductsPage: (from: number, to: number) => Promise<CsvExportPage<any>>;
  fetchVariantsPage: (from: number, to: number) => Promise<CsvExportPage<any>>;
  now?: Date;
};

export async function buildProductCsvExport(options: BuildProductCsvExportOptions) {
  const pageSize = options.pageSize ?? 500;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RangeError("CSV export pageSize must be between 1 and 1000");
  }

  const [products, variants] = await Promise.all([
    fetchEveryPage("products", pageSize, options.fetchProductsPage),
    fetchEveryPage("variants", pageSize, options.fetchVariantsPage),
  ]);
  const variantsByProduct = groupVariantsByProductId(variants as CsvVariant[]);
  const body = products.map((product) => {
    const virtual = variantVirtualFields(
      variantsByProduct.get(normalizedProductId(product.id)) || [],
    ) as Record<string, unknown>;
    return PRODUCT_CSV_FIELDS.map((field) => {
      const value = field in virtual ? virtual[field] : product[field];
      return csvTextCell(productCsvValue(field, value));
    }).join(",");
  });
  const csv = `\uFEFF${PRODUCT_CSV_FIELDS.join(",")}\n${body.join("\n")}${body.length ? "\n" : ""}`;
  const now = options.now ?? new Date();

  return {
    csv,
    productCount: products.length,
    variantCount: variants.length,
    filename: `products-export-${now.toISOString().slice(0, 10)}.csv`,
  };
}

export function createCsvDownloadHeaders(filename: string) {
  const safe = filename
    .replace(/[\r\n]/g, "")
    .replace(/[\\/\"]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-160) || "products-export.csv";

  return new Headers({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safe}"`,
    "Cache-Control": "no-store",
  });
}
