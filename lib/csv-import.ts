import {
  CsvInputError,
  PRODUCT_CSV_LIMITS,
  parseProductCsvBytes,
  parseStrictCsvBoolean,
  parseStrictCsvJson,
  parseStrictCsvNumber,
  parseStrictSizeStock,
} from "@/lib/csv-parser";
import { PRODUCT_CSV_FIELDS } from "@/lib/csv-output";
import {
  buildCsvVariantInputs,
  type CsvVariantInput,
} from "@/lib/csv-variant-input";
import {
  isProductCategory,
  isProductSubcategory,
} from "@/lib/types";
import { FIXED_PRODUCT_VAT_RATE, isFixedProductVat } from "@/lib/product-policy";

export type ProductCsvImportMode = "create_only" | "update_existing" | "upsert";
export type ProductCsvInventoryMode = "metadata_only" | "set_inventory";

export const PRODUCT_CSV_HEADER_ALIASES: Record<string, string> = {
  "product sku": "sku",
  "商品sku": "sku",
  "商品 sku": "sku",
  title: "name_cn",
  "product name": "name_cn",
  "商品名称": "name_cn",
  "中文名称": "name_cn",
  description: "description_cn",
  "商品描述": "description_cn",
  "一级分类": "category",
  "二级分类": "subcategory",
  "售价": "price",
  "库存": "stock",
  "尺码": "sizes",
  "尺码库存": "size_stock",
};

export const PRODUCT_CSV_REQUIRED_HEADERS = [
  "sku",
  "name_cn",
  "category",
  "subcategory",
  "price",
] as const;

type JsonObject = Record<string, unknown>;

export type NormalizedProductImportVariant = CsvVariantInput;

export type NormalizedProductImportRow = {
  rowNumber: number;
  normalizedSku: string;
  metadata: JsonObject;
  variants: NormalizedProductImportVariant[];
  values: Record<string, string>;
};

const SIZE_SYSTEMS = new Set([
  "letter",
  "eu_women_numeric",
  "eu_men_numeric",
  "eu_shoes",
  "one_size",
  "custom",
]);

const TEXT_FIELDS = [
  "name_cn",
  "description_cn",
  "name_en",
  "description_en",
  "name_gr",
  "description_gr",
  "category",
  "subcategory",
  "image_url",
  "brand",
  "supplier_style_code",
  "barcode",
  "ean",
  "mpn",
  "color",
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
] as const;

function rowError(rowNumber: number, field: string, message: string) {
  return new CsvInputError("CSV_INVALID_JSON_SCHEMA", message, { rowNumber, field });
}

function parseSizes(value: string, rowNumber: number) {
  if (!value.trim()) return [];
  const sizes = value.split(",").map((size) => size.trim().toUpperCase());
  if (sizes.some((size) => !size) || sizes.length > PRODUCT_CSV_LIMITS.maxSizes) {
    throw rowError(rowNumber, "sizes", "sizes contains an empty value or too many sizes.");
  }
  if (new Set(sizes).size !== sizes.length) {
    throw rowError(rowNumber, "sizes", "sizes contains a duplicate size.");
  }
  return sizes;
}

function parseVariantMap<T>(
  raw: string,
  rowNumber: number,
  field: string,
  parseValue: (value: string, size: string) => T,
) {
  const result = new Map<string, T>();
  if (!raw.trim()) return result;
  for (const token of raw.split(",")) {
    const separator = token.indexOf(":");
    if (separator <= 0 || separator !== token.lastIndexOf(":")) {
      throw rowError(rowNumber, field, `${field} must use SIZE:VALUE tokens separated by commas.`);
    }
    const size = token.slice(0, separator).trim().toUpperCase();
    const value = token.slice(separator + 1).trim();
    if (!size || !value || result.has(size)) {
      throw rowError(rowNumber, field, `${field} contains an empty or duplicate size.`);
    }
    result.set(size, parseValue(value, size));
  }
  return result;
}

function optionalUuid(value: string, rowNumber: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw rowError(rowNumber, "supplier_id", "supplier_id must be a UUID.");
  }
  return trimmed;
}

function validateHttpUrl(value: string, rowNumber: number, field: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    return url.toString();
  } catch {
    throw rowError(rowNumber, field, `${field} must be an HTTP or HTTPS URL.`);
  }
}

function createMetadata(
  values: Record<string, string>,
  headers: Set<string>,
  rowNumber: number,
) {
  const sku = values.sku.trim();
  if (!sku || sku.length > 200) throw rowError(rowNumber, "sku", "SKU is required and must be at most 200 characters.");
  if (!values.name_cn.trim()) throw rowError(rowNumber, "name_cn", "Chinese product name is required.");
  if (!isProductCategory(values.category.trim())) throw rowError(rowNumber, "category", "category is invalid.");
  if (!values.subcategory.trim() || !isProductSubcategory(values.category.trim(), values.subcategory.trim())) {
    throw rowError(rowNumber, "subcategory", "subcategory does not belong to category.");
  }

  const metadata: JsonObject = {};
  for (const field of TEXT_FIELDS) {
    if (headers.has(field)) metadata[field] = values[field]?.trim() || "";
  }
  metadata.sku = sku;
  metadata.price = parseStrictCsvNumber(values.price, { field: "price", min: 0, max: 1_000_000 });
  if (headers.has("vat") && !isFixedProductVat(values.vat)) {
    throw rowError(rowNumber, "vat", "vat is fixed at 24.");
  }
  metadata.vat = FIXED_PRODUCT_VAT_RATE;
  if (headers.has("is_active")) {
    metadata.is_active = values.is_active.trim()
      ? parseStrictCsvBoolean(values.is_active, { field: "is_active" })
      : true;
  }
  if (headers.has("material_verified")) {
    metadata.material_verified = values.material_verified.trim()
      ? parseStrictCsvBoolean(values.material_verified, { field: "material_verified" })
      : false;
  }
  if (headers.has("size_system")) {
    const system = values.size_system.trim().toLowerCase();
    if (system && !SIZE_SYSTEMS.has(system)) throw rowError(rowNumber, "size_system", "size_system is invalid.");
    metadata.size_system = system || null;
  }
  const supplierId = headers.has("supplier_id") ? optionalUuid(values.supplier_id, rowNumber) : null;
  if (headers.has("supplier_id")) metadata.supplier_id = supplierId;

  if (headers.has("image_url")) metadata.image_url = validateHttpUrl(values.image_url, rowNumber, "image_url");
  for (const field of ["image_urls", "ai_keywords", "style_tags"] as const) {
    if (!headers.has(field)) continue;
    const raw = values[field].trim();
    const parsed = raw
      ? parseStrictCsvJson(raw, {
          field,
          schema: "string_array",
          maxDepth: 3,
          maxItems: field === "image_urls" ? PRODUCT_CSV_LIMITS.maxImageUrls : 100,
          maxStringChars: 2_048,
        }) as string[]
      : [];
    if (field === "image_urls") parsed.forEach((url) => validateHttpUrl(url, rowNumber, field));
    metadata[field] = parsed;
  }
  if (headers.has("size_chart")) {
    metadata.size_chart = values.size_chart.trim()
      ? parseStrictCsvJson(values.size_chart, { field: "size_chart", schema: "object" })
      : {};
  }
  return { metadata, supplierId };
}

function normalizeRow(
  row: { rowNumber: number; normalizedSku: string; values: Record<string, string> },
  headers: Set<string>,
  inventoryMode: ProductCsvInventoryMode,
) : NormalizedProductImportRow {
  const { metadata, supplierId } = createMetadata(row.values, headers, row.rowNumber);
  const sizes = parseSizes(row.values.sizes || "", row.rowNumber);
  const hasStock = headers.has("stock") && row.values.stock.trim() !== "";
  const hasSizeStock = headers.has("size_stock") && row.values.size_stock.trim() !== "";
  let quantities: Record<string, number> = {};

  if (inventoryMode === "metadata_only") {
    if (hasStock || hasSizeStock) {
      throw rowError(
        row.rowNumber,
        hasSizeStock ? "size_stock" : "stock",
        "Inventory values require the explicit set_inventory mode.",
      );
    }
    quantities = Object.fromEntries((sizes.length ? sizes : ["ONE SIZE"]).map((size) => [size, 0]));
  } else if (hasSizeStock) {
    quantities = parseStrictSizeStock(row.values.size_stock, {
      sizes: sizes.length ? sizes : undefined,
      maxQuantity: 1_000_000,
    });
    const total = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
    if (hasStock) {
      const stock = parseStrictCsvNumber(row.values.stock, { field: "stock", integer: true, min: 0, max: 1_000_000 });
      if (stock !== total) throw rowError(row.rowNumber, "stock", "stock must equal the sum of size_stock.");
    }
  } else {
    if (!hasStock) throw rowError(row.rowNumber, "stock", "set_inventory requires stock or size_stock.");
    const stock = parseStrictCsvNumber(row.values.stock, { field: "stock", integer: true, min: 0, max: 1_000_000 });
    if (sizes.length > 1) {
      throw rowError(row.rowNumber, "size_stock", "Multiple sizes require an explicit size_stock quantity for every size.");
    }
    quantities = { [sizes[0] || "ONE SIZE"]: stock };
  }

  const supplierSkus = parseVariantMap(row.values.variant_supplier_skus || "", row.rowNumber, "variant_supplier_skus", (value) => value);
  const costPrices = parseVariantMap(row.values.variant_cost_prices || "", row.rowNumber, "variant_cost_prices", (value, size) => (
    parseStrictCsvNumber(value, { field: `variant_cost_prices.${size}`, min: 0, max: 1_000_000 })
  ));
  const reorderLevels = parseVariantMap(row.values.variant_reorder_levels || "", row.rowNumber, "variant_reorder_levels", (value, size) => (
    parseStrictCsvNumber(value, { field: `variant_reorder_levels.${size}`, integer: true, min: 0, max: 1_000_000 })
  ));
  const targetSizes = Object.keys(quantities);
  for (const size of new Set([...supplierSkus.keys(), ...costPrices.keys(), ...reorderLevels.keys()])) {
    if (!targetSizes.includes(size)) throw rowError(row.rowNumber, "variant_supplier_skus", `Procurement data references undeclared size ${size}.`);
  }

  const sku = String(metadata.sku);
  const price = Number(metadata.price);
  const color = String(metadata.color || "");
  const variants = buildCsvVariantInputs({
    headers,
    sku,
    price,
    color,
    supplierId,
    quantities,
    supplierSkus,
    costPrices,
    reorderLevels,
  });

  return {
    rowNumber: row.rowNumber,
    normalizedSku: row.normalizedSku,
    metadata,
    variants,
    values: row.values,
  };
}

export function parseAndNormalizeProductCsv(
  bytes: Uint8Array,
  options: { importMode: ProductCsvImportMode; inventoryMode: ProductCsvInventoryMode },
) {
  const parsed = parseProductCsvBytes(bytes, {
    allowedHeaders: PRODUCT_CSV_FIELDS,
    requiredHeaders: PRODUCT_CSV_REQUIRED_HEADERS,
    headerAliases: PRODUCT_CSV_HEADER_ALIASES,
    importMode: options.importMode,
    inventoryMode: options.inventoryMode,
  });
  const headers = new Set(parsed.headers);
  const rows = parsed.rows.map((row) => normalizeRow(row, headers, options.inventoryMode));
  return { ...parsed, rows };
}

export function applyProductCsvTranslations(
  rows: NormalizedProductImportRow[],
  translations: unknown,
) {
  if (translations === undefined || translations === null || translations === "") return rows;
  if (!Array.isArray(translations) || translations.length > rows.length) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", "translations must be a bounded row array.");
  }
  const byRow = new Map<number, Record<string, unknown>>();
  for (const item of translations) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", "Every translation must be an object.");
    }
    const value = item as Record<string, unknown>;
    const rowNumber = Number(value.rowNumber);
    if (!Number.isSafeInteger(rowNumber) || byRow.has(rowNumber)) {
      throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", "Translation row numbers must be unique integers.");
    }
    for (const field of ["name_en", "description_en", "name_gr", "description_gr"]) {
      if (field in value && (typeof value[field] !== "string" || String(value[field]).length > PRODUCT_CSV_LIMITS.maxCellChars)) {
        throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", `Translation ${field} is invalid.`);
      }
    }
    byRow.set(rowNumber, value);
  }
  return rows.map((row) => {
    const translated = byRow.get(row.rowNumber);
    if (!translated) return row;
    const metadata = { ...row.metadata };
    for (const field of ["name_en", "description_en", "name_gr", "description_gr"]) {
      if (typeof translated[field] === "string") metadata[field] = String(translated[field]).trim();
    }
    return { ...row, metadata };
  });
}
