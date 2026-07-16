import type { AdminRole } from "./admin-auth";

type JsonObject = Record<string, any>;

export const ADMIN_PRIVATE_CACHE_CONTROL = "private, no-store, max-age=0";

const PRODUCT_PROCUREMENT_FIELDS = [
  "supplier_id",
  "supplier_name",
  "supplier_style_code",
  "supplier_sku",
  "cost_price",
  "reorder_level",
] as const;

const INVENTORY_PROCUREMENT_FIELDS = [
  "supplier_sku",
  "supplier_name",
  "supplier_style_code",
  "cost_price",
  "reorder_level",
] as const;

function copyWithout<T extends JsonObject>(value: T, fields: readonly string[]) {
  const copy: JsonObject = { ...value };
  for (const field of fields) delete copy[field];
  return copy;
}

function copyProduct(value: JsonObject) {
  const variants = Array.isArray(value.variants)
    ? value.variants.map((variant: JsonObject) => ({ ...variant }))
    : value.variants;
  const procurement = value.variant_procurement && typeof value.variant_procurement === "object"
    ? Object.fromEntries(Object.entries(value.variant_procurement).map(([size, item]) => [
      size,
      item && typeof item === "object" ? { ...(item as JsonObject) } : item,
    ]))
    : value.variant_procurement;
  return { ...value, variants, variant_procurement: procurement };
}

export function shapeProductForRole<T extends JsonObject>(value: T, role: AdminRole): JsonObject {
  const product: JsonObject = copyProduct(value);
  if (role === "owner") return product;

  if (role === "inventory") {
    delete product.cost_price;
    if (Array.isArray(product.variants)) {
      product.variants = product.variants.map((variant: JsonObject) => copyWithout(variant, ["cost_price"]));
    }
    if (product.variant_procurement && typeof product.variant_procurement === "object") {
      product.variant_procurement = Object.fromEntries(
        Object.entries(product.variant_procurement).map(([size, item]) => [
          size,
          item && typeof item === "object" ? copyWithout(item as JsonObject, ["cost_price"]) : item,
        ]),
      );
    }
    return product;
  }

  const shaped = copyWithout(product, PRODUCT_PROCUREMENT_FIELDS);
  delete shaped.variant_procurement;
  if (Array.isArray(product.variants)) {
    shaped.variants = product.variants.map((variant: JsonObject) => copyWithout(variant, PRODUCT_PROCUREMENT_FIELDS));
  }
  return shaped;
}

export function shapeProductsForRole<T extends JsonObject>(values: T[], role: AdminRole) {
  return values.map((value) => shapeProductForRole(value, role));
}

export function shapeInventoryOverviewForRole<T extends JsonObject>(result: T, role: AdminRole): JsonObject {
  const items = Array.isArray(result.items) ? result.items : [];
  if (role === "owner") return { ...result, items: items.map((item: JsonObject) => ({ ...item })) };
  const fields = role === "inventory" ? ["cost_price"] : INVENTORY_PROCUREMENT_FIELDS;
  return { ...result, items: items.map((item: JsonObject) => copyWithout(item, fields)) };
}

export function shapeSupplierForRole<T extends JsonObject>(supplier: T, role: AdminRole): JsonObject {
  if (role === "owner") return { ...supplier };
  if (role === "inventory") {
    return {
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      active: supplier.active !== false,
    };
  }
  return {};
}

export function shapeSuppliersForRole<T extends JsonObject>(suppliers: T[], role: AdminRole) {
  return suppliers.map((supplier) => shapeSupplierForRole(supplier, role));
}
