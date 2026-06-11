import type { Product, ProductCategory } from "./types";

export type Language = "el" | "en";

export function getLanguage(value: string | string[] | undefined): Language {
  return value === "en" ? "en" : "el";
}

export function withLanguage(path: string, language: Language) {
  if (language === "el") {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}lang=en`;
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
    eyebrow: "Ελληνικό κατάστημα μόδας",
    intro: "Επιλεγμένα ρούχα, παπούτσια, τσάντες και αξεσουάρ με καθαρή μεσογειακή αισθητική.",
    latest: "Νέα προϊόντα",
    latestText: "Οι πιο πρόσφατες επιλογές από τη συλλογή μας.",
    cannotLoad: "Τα προϊόντα δεν μπορούν να φορτωθούν ακόμα.",
    noProducts: "Δεν υπάρχουν προϊόντα ακόμα.",
    noCategoryProducts: "Δεν υπάρχουν προϊόντα σε αυτή την κατηγορία ακόμα.",
    backHome: "Πίσω στην αρχική",
    inStock: "Σε απόθεμα",
    outOfStock: "Εξαντλημένο",
    contact: "Επικοινωνία",
    greek: "Ελληνικά",
    english: "English",
    viewDetails: "Λεπτομέρειες",
    shopLatest: "Δείτε τη συλλογή",
    categories: "Κατηγορίες",
    whatsapp: "Ρωτήστε στο WhatsApp",
    description: "Περιγραφή",
    category: "Κατηγορία",
    subcategory: "Υποκατηγορία",
    sizes: "Μεγέθη"
  },
  en: {
    eyebrow: "Greek clothing store",
    intro: "Curated clothing, shoes, bags and accessories with a clean Mediterranean feel.",
    latest: "Latest products",
    latestText: "Newest pieces from our collection.",
    cannotLoad: "Products cannot load yet.",
    noProducts: "No products yet.",
    noCategoryProducts: "No products in this category yet.",
    backHome: "Back home",
    inStock: "In stock",
    outOfStock: "Out of stock",
    contact: "Contact",
    greek: "Ελληνικά",
    english: "English",
    viewDetails: "View details",
    shopLatest: "Shop latest",
    categories: "Categories",
    whatsapp: "Ask on WhatsApp",
    description: "Description",
    category: "Category",
    subcategory: "Subcategory",
    sizes: "Sizes"
  }
};
