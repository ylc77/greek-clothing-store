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
  name_cn: string | null;
  name_gr: string;
  name_en: string;
  description_cn: string | null;
  description_gr: string | null;
  description_en: string | null;
  category: ProductCategory;
  price: number;
  stock: number;
  sizes: string | null;
  image_url: string;
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
  price: number;
  stock: number;
  sizes: string;
  image_url: string;
};
