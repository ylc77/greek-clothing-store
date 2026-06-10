import type { Product, ProductCategory } from "./types";

export type Language = "el" | "en";

export function getLanguage(value: string | string[] | undefined): Language {
  return value === "en" ? "en" : "el";
}

export function withLanguage(path: string, language: Language) {
  return language === "en" ? `${path}?lang=en` : path;
}

export function productName(product: Product, language: Language) {
  return language === "en" ? product.name_en || product.name_gr : product.name_gr || product.name_en;
}

export const categoryLabels: Record<ProductCategory, Record<Language, string>> = {
  men: { el: "Ανδρικά", en: "Men" },
  women: { el: "Γυναικεία", en: "Women" },
  shoes: { el: "Παπούτσια", en: "Shoes" },
  bags: { el: "Τσάντες", en: "Bags" },
  luggage: { el: "Βαλίτσες", en: "Luggage" },
  hats: { el: "Καπέλα", en: "Hats" },
  jewelry: { el: "Κοσμήματα", en: "Jewelry" },
  other: { el: "Άλλα", en: "Other" }
};

export const text = {
  el: {
    eyebrow: "Ελληνικό κατάστημα",
    intro: "Απλό ηλεκτρονικό κατάστημα για ρούχα, παπούτσια, τσάντες και αξεσουάρ.",
    latest: "Νέα προϊόντα",
    latestText: "Τα πιο πρόσφατα προϊόντα από το κατάστημα.",
    cannotLoad: "Τα προϊόντα δεν μπορούν να φορτωθούν ακόμα.",
    noProducts: "Δεν υπάρχουν προϊόντα ακόμα.",
    noCategoryProducts: "Δεν υπάρχουν προϊόντα σε αυτή την κατηγορία ακόμα.",
    backHome: "Πίσω στην αρχική",
    inStock: "Σε απόθεμα",
    outOfStock: "Εξαντλημένο",
    contact: "Επικοινωνία",
    greek: "Ελληνικά",
    english: "English"
  },
  en: {
    eyebrow: "Greek clothing store",
    intro: "Simple storefront for clothing, shoes, bags and accessories.",
    latest: "Latest products",
    latestText: "Newest products from the store.",
    cannotLoad: "Products cannot load yet.",
    noProducts: "No products yet.",
    noCategoryProducts: "No products in this category yet.",
    backHome: "Back home",
    inStock: "In stock",
    outOfStock: "Out of stock",
    contact: "Contact",
    greek: "Ελληνικά",
    english: "English"
  }
};
