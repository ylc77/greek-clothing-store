import type { Product } from "./types";

export type CategoryPriceFilter = "all" | "under-25" | "25-50" | "over-50";
export type CategorySort = "newest" | "price-asc" | "price-desc" | "name";

export type CategoryProductFilters = {
  brand: string;
  color: string;
  price: CategoryPriceFilter;
  sizes: string[];
  sort: CategorySort;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: unknown) {
  return clean(value).toLocaleLowerCase();
}

export function productSizeLabels(product: Pick<Product, "sizes" | "size_stock">) {
  const sizeStock = product.size_stock;
  if (sizeStock && typeof sizeStock === "object" && !Array.isArray(sizeStock)) {
    return Object.entries(sizeStock)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([size]) => clean(size))
      .filter(Boolean);
  }

  return Array.from(new Set(
    clean(product.sizes)
      .split(/[\/,\s]+/)
      .map(clean)
      .filter(Boolean),
  ));
}

export function categoryProductFilterOptions(products: Product[]) {
  const sizes = new Map<string, { value: string; count: number }>();
  const colors = new Map<string, { value: string; count: number }>();
  const brands = new Map<string, { value: string; count: number }>();

  for (const product of products) {
    for (const size of productSizeLabels(product)) {
      const key = normalized(size);
      const current = sizes.get(key);
      sizes.set(key, { value: current?.value || size, count: (current?.count || 0) + 1 });
    }

    const color = clean(product.color);
    if (color) {
      const key = normalized(color);
      const current = colors.get(key);
      colors.set(key, { value: current?.value || color, count: (current?.count || 0) + 1 });
    }

    const brand = clean(product.brand);
    if (brand) {
      const key = normalized(brand);
      const current = brands.get(key);
      brands.set(key, { value: current?.value || brand, count: (current?.count || 0) + 1 });
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return {
    sizes: Array.from(sizes.values()).sort((left, right) => collator.compare(left.value, right.value)),
    colors: Array.from(colors.values()).sort((left, right) => collator.compare(left.value, right.value)),
    brands: Array.from(brands.values()).sort((left, right) => collator.compare(left.value, right.value)),
  };
}

export function filterAndSortCategoryProducts(
  products: Product[],
  filters: CategoryProductFilters,
  language: "el" | "en",
) {
  const filtered = products.filter((product) => {
    const price = Number(product.price) || 0;
    if (filters.price === "under-25" && price >= 25) return false;
    if (filters.price === "25-50" && (price < 25 || price > 50)) return false;
    if (filters.price === "over-50" && price <= 50) return false;
    if (filters.sizes.length > 0 && !productSizeLabels(product).some((size) => filters.sizes.some((selected) => normalized(size) === normalized(selected)))) return false;
    if (filters.color && normalized(product.color) !== normalized(filters.color)) return false;
    if (filters.brand && normalized(product.brand) !== normalized(filters.brand)) return false;
    return true;
  });

  const name = (product: Product) => language === "el" ? product.name_gr : product.name_en;
  const collator = new Intl.Collator(language === "el" ? "el" : "en", { numeric: true, sensitivity: "base" });
  return filtered.sort((left, right) => {
    if (filters.sort === "price-asc") return Number(left.price) - Number(right.price);
    if (filters.sort === "price-desc") return Number(right.price) - Number(left.price);
    if (filters.sort === "name") return collator.compare(name(left), name(right));
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
}
