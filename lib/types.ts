export type ProductCategory = string; // dynamic: categories managed via DB

export type SizeSystem =
  | "letter"
  | "eu_women_numeric"
  | "eu_men_numeric"
  | "eu_shoes"
  | "one_size"
  | "custom";

export type VariantProcurement = {
  supplier_sku: string;
  cost_price: number | null;
  reorder_level: number | null;
};

export type Supplier = {
  id: string;
  code: string;
  name: string;
  vat_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

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
} as const satisfies Record<string, readonly string[]>;

// Mutable copy for dynamic category access (DB categories)
export const subcategoryList: Record<string, string[]> = {};
for (const [k, v] of Object.entries(subcategoriesByCategory)) {
  subcategoryList[k] = [...v];
}

export type ProductSubcategory = string; // dynamic: subcategories managed via DB

export function isProductCategory(value: string): value is ProductCategory {
  // Accept any non-empty string — categories come from DB now
  return typeof value === "string" && value.trim().length > 0;
}

export function isProductSubcategory(category: ProductCategory, value: string): value is ProductSubcategory {
  // Accept any non-empty string — subcategories come from DB now
  return typeof value === "string" && value.trim().length > 0;
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
  size_system?: SizeSystem | null;
  size_stock?: Record<string, number> | null;
  image_url: string;
  image_urls: string[] | null;
  brand?: string | null;
  supplier_id?: string | null;
  supplier_style_code?: string | null;
  barcode?: string | null;
  ean?: string | null;
  vat?: number | null;
  color?: string | null;
  public_variants?: Array<{
    size: string;
    color: string;
    quantity_available: number;
    price: number | null;
    fulfillment_profile?: "boxnow_and_pickup" | "pickup_only";
  }>;
  additional_image_urls?: string | null;
  skroutz_url?: string | null;
  material?: string | null;
  material_verified?: boolean | null;
  size_chart?: Record<string, unknown> | null;
  fit_type?: string | null;
  fiber_composition_gr?: string | null;
  fiber_composition_en?: string | null;
  care_instructions_gr?: string | null;
  care_instructions_en?: string | null;
  country_of_origin?: string | null;
  manufacturer_name?: string | null;
  manufacturer_contact?: string | null;
  eu_responsible_person?: string | null;
  product_safety_notes_gr?: string | null;
  product_safety_notes_en?: string | null;
  fit?: string | null;
  season?: string | null;
  mpn?: string | null;
  availability?: string | null;
  category_path_en?: string | null;
  category_path_gr?: string | null;
  is_active?: boolean | null;
  fulfillment_profile?: "boxnow_and_pickup" | "pickup_only" | null;
  shipping_note_en?: string | null;
  shipping_note_gr?: string | null;
  shipping_note_zh?: string | null;
  package_weight_grams?: number | null;
  package_length_mm?: number | null;
  package_width_mm?: number | null;
  package_height_mm?: number | null;
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
  size_system: SizeSystem | "";
  image_url: string;
  image_urls: string;
  brand: string;
  barcode: string;
  ean: string;
  mpn: string;
  vat: number;
  color: string;
  skroutz_url: string;
  is_active: boolean;
  fit_type: string;
  material: string;
  supplier_id: string;
  supplier_style_code: string;
  fiber_composition_gr: string;
  fiber_composition_en: string;
  care_instructions_gr: string;
  care_instructions_en: string;
  country_of_origin: string;
  manufacturer_name: string;
  manufacturer_contact: string;
  eu_responsible_person: string;
  product_safety_notes_gr: string;
  product_safety_notes_en: string;
  ai_keywords: string;
  style_tags: string;
  size_chart: string;
  material_verified: boolean;
  fulfillment_profile: "boxnow_and_pickup" | "pickup_only";
  shipping_note_en: string;
  shipping_note_gr: string;
  shipping_note_zh: string;
  package_weight_grams: number | "";
  package_length_mm: number | "";
  package_width_mm: number | "";
  package_height_mm: number | "";
};
