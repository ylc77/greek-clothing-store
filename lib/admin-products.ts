import { isProductCategory, type Product, type ProductFormData } from "./types";

export type AdminProductPayload = {
  sku?: unknown;
  name_cn?: unknown;
  name_gr?: unknown;
  name_en?: unknown;
  description_cn?: unknown;
  description_gr?: unknown;
  description_en?: unknown;
  category?: unknown;
  price?: unknown;
  stock?: unknown;
  sizes?: unknown;
  image_url?: unknown;
};

export type ProductMutation = Omit<ProductFormData, "category"> & {
  category: Product["category"];
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

export function adminPasswordIsValid(password: string | null) {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected && password && password === expected);
}

export function validateProductPayload(payload: AdminProductPayload) {
  const sku = stringValue(payload.sku);
  const category = stringValue(payload.category);
  const price = numberValue(payload.price);
  const stock = numberValue(payload.stock);
  const errors: string[] = [];

  if (!sku) {
    errors.push("sku is required");
  }

  if (!isProductCategory(category)) {
    errors.push("category must be one of the fixed categories");
  }

  if (!Number.isFinite(price) || price < 0) {
    errors.push("price must be a valid number");
  }

  if (!Number.isFinite(stock) || stock < 0) {
    errors.push("stock must be a valid number");
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
          price,
          stock: Math.trunc(stock),
          sizes: stringValue(payload.sizes),
          image_url: stringValue(payload.image_url)
        }
      : null;

  return { errors, mutation };
}

export function productForForm(product: Product): ProductFormData & { id: string } {
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
    price: Number(product.price),
    stock: Number(product.stock),
    sizes: product.sizes || "",
    image_url: product.image_url || ""
  };
}
