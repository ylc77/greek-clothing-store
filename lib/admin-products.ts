import {
  isProductCategory,
  isProductSubcategory,
  subcategoriesByCategory,
  subcategoryList,
  type Product,
  type ProductFormData
} from "./types";

export type AdminProductPayload = {
  sku?: unknown;
  name_cn?: unknown;
  name_gr?: unknown;
  name_en?: unknown;
  description_cn?: unknown;
  description_gr?: unknown;
  description_en?: unknown;
  category?: unknown;
  subcategory?: unknown;
  price?: unknown;
  stock?: unknown;
  sizes?: unknown;
  size_stock?: unknown;
  image_url?: unknown;
  image_urls?: unknown;
  brand?: unknown;
  barcode?: unknown;
  ean?: unknown;
  vat?: unknown;
  color?: unknown;
  additional_image_urls?: unknown;
  skroutz_url?: unknown;
  material?: unknown;
  fit?: unknown;
  season?: unknown;
  mpn?: unknown;
  availability?: unknown;
  category_path_en?: unknown;
  category_path_gr?: unknown;
  is_active?: unknown;
};

export type ProductMutation = Omit<ProductFormData, "category" | "image_urls"> & {
  category: Product["category"];
  image_urls: string[];
  size_stock?: Record<string, number>;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }

  if (typeof value === "string") {
    return Number(value.trim().replace(",", "."));
  }

  return NaN;
}

function parseSizeStock(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") rec[k] = Math.max(0, Math.trunc(v));
  }
  return Object.keys(rec).length > 0 ? rec : undefined;
}

function imageUrlsValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\r?\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function adminPasswordIsValid(password: string | null) {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected && password && password === expected);
}

export function validateProductPayload(payload: AdminProductPayload) {
  const sku = stringValue(payload.sku);
  const category = stringValue(payload.category);
  const subcategory = stringValue(payload.subcategory);
  const price = numberValue(payload.price);
  const stock = numberValue(payload.stock);
  const vat = payload.vat === undefined || payload.vat === "" ? 24 : numberValue(payload.vat);
  const errors: string[] = [];

  if (!sku) {
    errors.push("sku is required");
  }

  if (!isProductCategory(category)) {
    errors.push("category must be one of the fixed categories");
  }

  if (isProductCategory(category) && subcategory && !isProductSubcategory(category, subcategory)) {
    errors.push("subcategory must match the selected category");
  }

  if (!Number.isFinite(price) || price < 0) {
    errors.push("price must be a valid number");
  }

  if (!Number.isFinite(stock) || stock < 0) {
    errors.push("stock must be a valid number");
  }

  if (!Number.isFinite(vat) || vat < 0) {
    errors.push("vat must be a valid number");
  }

  const mutation: ProductMutation | null =
    errors.length === 0 && isProductCategory(category)
      ? {
          sku,
          name_cn: stringValue(payload.name_cn),
          name_gr: stringValue(payload.name_gr),
          name_en: stringValue(payload.name_en),
          description_cn: stringValue(payload.description_cn),
          description_gr: stringValue(payload.description_gr),
          description_en: stringValue(payload.description_en),
          category,
          subcategory: subcategory || subcategoryList[category][0],
          price,
          stock: Math.trunc(stock),
          sizes: stringValue(payload.sizes),
          image_url: stringValue(payload.image_url),
          image_urls: imageUrlsValue(payload.image_urls),
          brand: stringValue(payload.brand),
          barcode: stringValue(payload.barcode),
          vat,
          color: stringValue(payload.color),
          skroutz_url: stringValue(payload.skroutz_url),
          is_active: payload.is_active === false ? false : true,
          size_stock: parseSizeStock(payload.size_stock),
        }
      : null;

  return { errors, mutation };
}

export function productForForm(product: Product): ProductFormData & { id: string; size_stock?: Record<string, number> | null } {
  return {
    id: product.id,
    sku: product.sku,
    name_cn: product.name_cn || "",
    name_gr: product.name_gr || "",
    name_en: product.name_en || "",
    description_cn: product.description_cn || "",
    description_gr: product.description_gr || "",
    description_en: product.description_en || "",
    category: product.category,
    subcategory: product.subcategory || subcategoryList[product.category][0],
    price: Number(product.price),
    stock: Number(product.stock),
    sizes: product.sizes || "",
    image_url: product.image_url || "",
    image_urls: Array.isArray(product.image_urls) ? product.image_urls.join("\n") : "",
    brand: product.brand || "",
    barcode: product.barcode || "",
    vat: Number(product.vat ?? 24),
    color: product.color || "",
    skroutz_url: product.skroutz_url || "",
    is_active: product.is_active !== false,
    size_stock: (product as Record<string, unknown>).size_stock as Record<string, number> | null | undefined,
  };
}
