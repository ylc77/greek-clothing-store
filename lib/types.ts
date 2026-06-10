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
  label: string;
};

export const categories: Category[] = [
  { slug: "men", label: "Men" },
  { slug: "women", label: "Women" },
  { slug: "shoes", label: "Shoes" },
  { slug: "bags", label: "Bags" },
  { slug: "luggage", label: "Luggage" },
  { slug: "hats", label: "Hats" },
  { slug: "jewelry", label: "Jewelry" },
  { slug: "other", label: "Other" }
];

export function isProductCategory(value: string): value is ProductCategory {
  return categories.some((category) => category.slug === value);
}

export function getCategoryLabel(slug: ProductCategory) {
  return categories.find((category) => category.slug === slug)?.label || slug;
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
