export type ProductCategory =
  | "men"
  | "women"
  | "shoes"
  | "bags"
  | "luggage"
  | "hats"
  | "jewelry"
  | "other";

export type Category = {
  slug: ProductCategory;
};

export const categories: Category[] = [
  { slug: "men" },
  { slug: "women" },
  { slug: "shoes" },
  { slug: "bags" },
  { slug: "luggage" },
  { slug: "hats" },
  { slug: "jewelry" },
  { slug: "other" }
];

export const subcategoriesByCategory = {
  men: ["tshirts", "shirts", "hoodies", "jackets", "trousers", "jeans", "shorts"],
  women: ["dresses", "tops", "shirts", "hoodies", "jackets", "trousers", "skirts"],
  shoes: ["sneakers", "boots", "sandals", "heels"],
  bags: ["handbags", "backpacks", "wallets"],
  luggage: ["suitcases", "travel_bags"],
  hats: ["caps", "beanies"],
  jewelry: ["necklaces", "bracelets", "earrings", "rings"],
  other: ["accessories"]
} as const satisfies Record<ProductCategory, readonly string[]>;

export type ProductSubcategory = (typeof subcategoriesByCategory)[ProductCategory][number];

export function isProductCategory(value: string): value is ProductCategory {
  return categories.some((category) => category.slug === value);
}

export function isProductSubcategory(category: ProductCategory, value: string): value is ProductSubcategory {
  return (subcategoriesByCategory[category] as readonly string[]).includes(value);
}

export type Product = {
  id: string;
  sku: string;
  name_cn: string | null;
  name_gr: string;
  name_en: string;
  description_cn: string | null;
  description_gr: string | null;
  description_en: string | null;
  category: ProductCategory;
  subcategory: ProductSubcategory | null;
  price: number;
  stock: number;
  sizes: string | null;
  size_stock?: Record<string, number> | null;
  image_url: string;
  image_urls: string[] | null;
  brand?: string | null;
  barcode?: string | null;
  ean?: string | null;
  vat?: number | null;
  color?: string | null;
  additional_image_urls?: string | null;
  skroutz_url?: string | null;
  material?: string | null;
  fit?: string | null;
  season?: string | null;
  mpn?: string | null;
  availability?: string | null;
  category_path_en?: string | null;
  category_path_gr?: string | null;
  is_active?: boolean | null;
  updated_at?: string | null;
  created_at: string;
};

export type ProductFormData = {
  sku: string;
  name_cn: string;
  name_gr: string;
  name_en: string;
  description_cn: string;
  description_gr: string;
  description_en: string;
  category: ProductCategory;
  subcategory: string;
  price: number;
  stock: number;
  sizes: string;
  image_url: string;
  image_urls: string;
  brand: string;
  barcode: string;
  vat: number;
  color: string;
  skroutz_url: string;
  is_active: boolean;
};
