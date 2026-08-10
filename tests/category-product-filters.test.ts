import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { categoryProductFilterOptions, filterAndSortCategoryProducts, productSizeLabels } from "../lib/category-product-filters.ts";
import type { Product } from "../lib/types.ts";

function product(overrides: Partial<Product>): Product {
  return {
    id: overrides.id || "1",
    sku: overrides.sku || "SKU-1",
    name_cn: null,
    name_gr: overrides.name_gr || "Προϊόν",
    name_en: overrides.name_en || "Product",
    description_cn: null,
    description_gr: null,
    description_en: null,
    category: "women",
    subcategory: "dresses",
    price: overrides.price ?? 30,
    stock: overrides.stock ?? 1,
    sizes: overrides.sizes ?? "S M",
    size_stock: overrides.size_stock,
    image_url: "/test.webp",
    image_urls: [],
    brand: overrides.brand,
    color: overrides.color,
    created_at: overrides.created_at || "2026-08-01T00:00:00.000Z",
  };
}

test("available size labels exclude sold-out sizes", () => {
  assert.deepEqual(productSizeLabels(product({ size_stock: { S: 2, M: 0, L: 1 } })), ["S", "L"]);
});

test("filter options are de-duplicated and only include available sizes", () => {
  const options = categoryProductFilterOptions([
    product({ brand: "Helios", color: "Blue", size_stock: { S: 1, M: 0 } }),
    product({ id: "2", sku: "SKU-2", brand: "helios", color: "blue", size_stock: { M: 2 } }),
  ]);

  assert.deepEqual(options.sizes, [{ value: "M", count: 1 }, { value: "S", count: 1 }]);
  assert.deepEqual(options.brands, [{ value: "Helios", count: 2 }]);
  assert.deepEqual(options.colors, [{ value: "Blue", count: 2 }]);
});

test("category products filter by available size, color, brand and price", () => {
  const products = [
    product({ sku: "A", brand: "Helios", color: "Blue", price: 20, size_stock: { S: 1 } }),
    product({ sku: "B", brand: "Other", color: "Red", price: 35, size_stock: { M: 1 } }),
  ];
  const result = filterAndSortCategoryProducts(products, {
    brand: "helios",
    color: "blue",
    price: "under-25",
    sizes: ["s"],
    sort: "newest",
  }, "en");

  assert.deepEqual(result.map((item) => item.sku), ["A"]);
});

test("category products sort by price without mutating source order", () => {
  const products = [
    product({ sku: "A", price: 40 }),
    product({ sku: "B", price: 20 }),
  ];
  const result = filterAndSortCategoryProducts(products, {
    brand: "",
    color: "",
    price: "all",
    sizes: [],
    sort: "price-asc",
  }, "en");

  assert.deepEqual(result.map((item) => item.sku), ["B", "A"]);
  assert.deepEqual(products.map((item) => item.sku), ["A", "B"]);
});
