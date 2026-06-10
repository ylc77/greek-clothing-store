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

export function isProductCategory(value: string): value is ProductCategory {
  return categories.some((category) => category.slug === value);
}

export type Product = {
  id: string;
  sku: string;
  name_gr: string;
  name_en: string;
  description_gr: string | null;
  description_en: string | null;
  category: ProductCategory;
  price: number;
  stock: number;
  image_url: string;
  created_at: string;
};
