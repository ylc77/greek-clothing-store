import type { Product, ProductCategory, ProductSubcategory } from "./types";

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
  return language === "en"
    ? product.name_en || product.name_cn || product.sku
    : product.name_gr || product.name_en || product.name_cn || product.sku;
}

export function productDescription(product: Product, language: Language) {
  return language === "en"
    ? product.description_en || product.description_cn || ""
    : product.description_gr || product.description_en || product.description_cn || "";
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

export const subcategoryLabels: Record<ProductSubcategory, Record<Language, string>> = {
  tshirts: { el: "T-shirts", en: "T-shirts" },
  shirts: { el: "Πουκάμισα", en: "Shirts" },
  hoodies: { el: "Φούτερ", en: "Hoodies" },
  jackets: { el: "Μπουφάν", en: "Jackets" },
  trousers: { el: "Παντελόνια", en: "Trousers" },
  jeans: { el: "Τζιν", en: "Jeans" },
  shorts: { el: "Σορτς", en: "Shorts" },
  dresses: { el: "Φορέματα", en: "Dresses" },
  tops: { el: "Τοπ", en: "Tops" },
  skirts: { el: "Φούστες", en: "Skirts" },
  sneakers: { el: "Sneakers", en: "Sneakers" },
  boots: { el: "Μπότες", en: "Boots" },
  sandals: { el: "Σανδάλια", en: "Sandals" },
  heels: { el: "Γόβες", en: "Heels" },
  handbags: { el: "Τσάντες χειρός", en: "Handbags" },
  backpacks: { el: "Σακίδια", en: "Backpacks" },
  wallets: { el: "Πορτοφόλια", en: "Wallets" },
  suitcases: { el: "Βαλίτσες", en: "Suitcases" },
  travel_bags: { el: "Ταξιδιωτικές τσάντες", en: "Travel bags" },
  caps: { el: "Καπέλα", en: "Caps" },
  beanies: { el: "Σκούφοι", en: "Beanies" },
  necklaces: { el: "Κολιέ", en: "Necklaces" },
  bracelets: { el: "Βραχιόλια", en: "Bracelets" },
  earrings: { el: "Σκουλαρίκια", en: "Earrings" },
  rings: { el: "Δαχτυλίδια", en: "Rings" },
  accessories: { el: "Αξεσουάρ", en: "Accessories" }
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
    backToCategory: "Πίσω στην κατηγορία",
    inStock: "Σε απόθεμα",
    outOfStock: "Εξαντλημένο",
    contact: "Επικοινωνία",
    greek: "Ελληνικά",
    english: "English",
    shopLatest: "Δείτε τη συλλογή",
    categories: "Κατηγορίες",
    whatsapp: "Ρωτήστε στο WhatsApp",
    description: "Περιγραφή",
    category: "Κατηγορία",
    subcategory: "Υποκατηγορία",
    sizes: "Μεγέθη",
    all: "Όλα",
    items: "προϊόντα",
    brandHeading: "Helios Wear",
    brandIntro: "Ανακαλύψτε τη συλλογή μας με ρούχα, παπούτσια και αξεσουάρ, σχεδιασμένα για το μεσογειακό στυλ. Κάθε κομμάτι συνδυάζει άνεση, ποιότητα και διαχρονική αισθητική.",
    viewProducts: "Δείτε τα προϊόντα",
    newArrivals: "Νέες αφίξεις",
    storeInfo: "Το κατάστημά μας",
    storeAddress: "Ερμού 45, Αθήνα 10563",
    storeHours: "Δευτέρα - Παρασκευή: 10:00 - 20:00\nΣάββατο: 10:00 - 18:00\nΚυριακή: Κλειστά",
    findOnMaps: "Βρείτε μας στο Google Maps",
    followInstagram: "Ακολουθήστε μας στο Instagram",
    contactWhatsApp: "Επικοινωνήστε στο WhatsApp",
    skuLabel: "Κωδικός",
    color: "Χρώμα",
    material: "Υλικό",
    fit: "Εφαρμογή",
    season: "Σεζόν",
    checkStore: "Διαθεσιμότητα στο κατάστημα",
    askWhatsApp: "Ρωτήστε στο WhatsApp",
    viewSkroutz: "Δείτε στο Skroutz",
    noImage: "Χωρίς εικόνα",
    storeDescription: "Helios Wear — ελληνικό κατάστημα μόδας με έδρα την Αθήνα.",
    hours: "Ωράριο",
    about: "Σχετικά",
    siteName: "Helios Wear",
    copyright: "© 2026 Helios Wear. All rights reserved.",
    price: "Τιμή",
    stock: "Απόθεμα",
    sizeGuide: "Οδηγός μεγεθών",
    sizeGuideHelp: "Δεν είστε σίγουροι για το μέγεθος; Στείλτε μας το ύψος, το βάρος και το συνηθισμένο σας μέγεθος. Θα σας βοηθήσουμε.",
    selectSize: "Επιλέξτε πρώτα μέγεθος.",
    oneSize: "Ένα μέγεθος",
    whatsappAskProduct: "Προϊόν",
    whatsappAskSku: "SKU",
    whatsappAskSize: "Μέγεθος",
    whatsappCheckStore: "Είναι το \"{name}\" (SKU: {sku}) διαθέσιμο στο κατάστημά σας;"
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
    backToCategory: "Back to category",
    inStock: "In stock",
    outOfStock: "Out of stock",
    contact: "Contact",
    greek: "Ελληνικά",
    english: "English",
    shopLatest: "Shop latest",
    categories: "Categories",
    whatsapp: "Ask on WhatsApp",
    description: "Description",
    category: "Category",
    subcategory: "Subcategory",
    sizes: "Sizes",
    all: "All",
    items: "items",
    brandHeading: "Helios Wear",
    brandIntro: "Discover our collection of clothing, shoes and accessories designed for Mediterranean style. Each piece combines comfort, quality and timeless aesthetics.",
    viewProducts: "View products",
    newArrivals: "New arrivals",
    storeInfo: "Our store",
    storeAddress: "Ermou 45, Athens 10563, Greece",
    storeHours: "Monday - Friday: 10:00 - 20:00\nSaturday: 10:00 - 18:00\nSunday: Closed",
    findOnMaps: "Find us on Google Maps",
    followInstagram: "Follow us on Instagram",
    contactWhatsApp: "Contact on WhatsApp",
    skuLabel: "SKU",
    color: "Color",
    material: "Material",
    fit: "Fit",
    season: "Season",
    checkStore: "Check in store",
    askWhatsApp: "Ask on WhatsApp",
    viewSkroutz: "View on Skroutz",
    noImage: "No image",
    storeDescription: "Helios Wear — Greek fashion store based in Athens.",
    hours: "Hours",
    about: "About",
    siteName: "Helios Wear",
    copyright: "© 2026 Helios Wear. All rights reserved.",
    price: "Price",
    stock: "Stock",
    sizeGuide: "Size guide",
    sizeGuideHelp: "Not sure about your size? Send us your height, weight and usual size. We will help you choose.",
    selectSize: "Please select a size first.",
    oneSize: "One size",
    whatsappAskProduct: "Product",
    whatsappAskSku: "SKU",
    whatsappAskSize: "Size",
    whatsappCheckStore: "Is \"{name}\" (SKU: {sku}) available in your store?"
  }
};
