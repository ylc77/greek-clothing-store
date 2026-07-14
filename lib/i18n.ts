import type { Product, ProductCategory, ProductSubcategory } from "./types";

export type Language = "el" | "en";

export function storefrontText(value: unknown, fallback = "") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  if (!/[一-鿿]/.test(raw)) return raw;
  const cleaned = raw.replace(/[一-鿿]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

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
    ? product.name_en || product.name_gr || product.sku
    : product.name_gr || product.name_en || product.sku;
}

export function productDescription(product: Product, language: Language) {
  return language === "en"
    ? product.description_en || product.description_gr || ""
    : product.description_gr || product.description_en || "";
}

/** Convert Chinese/English material text to the target language */
export function getLocalizedMaterial(material: string | null | undefined, language: Language, verified?: boolean | null): string | null {
  if (!material || !material.trim()) return null;
  if (verified !== true) return null; // not confirmed, don't show
  const raw = material.trim();
  const mapping: Record<string, { en: string; el: string }> = {
    "棉": { en: "Cotton", el: "Βαμβάκι" },
    "纯棉": { en: "100% Cotton", el: "100% Βαμβάκι" },
    "涤纶": { en: "Polyester", el: "Πολυεστέρας" },
    "聚酯纤维": { en: "Polyester", el: "Πολυεστέρας" },
    "牛仔": { en: "Denim", el: "Τζιν" },
    "皮革": { en: "Leather", el: "Δέρμα" },
    "真皮": { en: "Leather", el: "Δέρμα" },
    "人造革": { en: "PU Leather", el: "Συνθετικό Δέρμα PU" },
    "羊毛": { en: "Wool", el: "Μαλλί" },
    "亚麻": { en: "Linen", el: "Λινό" },
    "丝绸": { en: "Silk", el: "Μετάξι" },
    "真丝": { en: "Silk", el: "Μετάξι" },
  };
  // Check raw value for Chinese chars
  const hasChinese = /[一-鿿]/.test(raw);
  if (hasChinese) {
    // Try to match Chinese segments
    for (const [cn, vals] of Object.entries(mapping)) {
      if (raw.includes(cn)) {
        const replaced = raw.replace(cn, language === "en" ? vals.en : vals.el);
        // Remove remaining Chinese characters
        const cleaned = replaced.replace(/[一-鿿]+/g, "").replace(/\s+/g, " ").trim();
        return cleaned || (language === "en" ? "Cotton" : "Βαμβάκι");
      }
    }
    // Unrecognized Chinese — hide
    return null;
  }
  // Already English text — translate to Greek if needed
  if (language === "el") {
    const enLower = raw.toLowerCase();
    for (const [, vals] of Object.entries(mapping)) {
      if (enLower.includes(vals.en.toLowerCase())) return raw.replace(new RegExp(vals.en, "i"), vals.el);
    }
    return raw; // return as-is if no mapping
  }
  return raw; // English, already fine
}

/** Convert English day names in opening hours to Greek */
export function localizeHours(hours: unknown, language: Language): string {
  const h = typeof hours === "string" ? hours : "";
  if (!h) return "";
  if (language === "el") {
    return h
      .replace(/Monday/g, "Δευτέρα")
      .replace(/Tuesday/g, "Τρίτη")
      .replace(/Wednesday/g, "Τετάρτη")
      .replace(/Thursday/g, "Πέμπτη")
      .replace(/Friday/g, "Παρασκευή")
      .replace(/Saturday/g, "Σάββατο")
      .replace(/Sunday/g, "Κυριακή")
      .replace(/Closed/g, "Κλειστά");
  }
  return h;
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
    eyebrow: "Athens boutique",
    intro: "Επιλεγμένα κομμάτια μόδας, παπούτσια, τσάντες και αξεσουάρ. Επικοινωνήστε μαζί μας για διαθεσιμότητα και μεγέθη.",
    latest: "Νέα προϊόντα",
    latestText: "Οι πιο πρόσφατες επιλογές από τη συλλογή μας.",
    categoryIntro: "Περιηγηθείτε στα πιο πρόσφατα προϊόντα αυτής της κατηγορίας.",
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
    brandHeading: "Fashion Boutique",
    brandIntro: "Ανακαλύψτε τη συλλογή μας με ρούχα, παπούτσια και αξεσουάρ, σχεδιασμένα για το μεσογειακό στυλ.",
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
    storeDescription: "Ελληνικό κατάστημα μόδας με έδρα την Αθήνα.",
    hours: "Ωράριο",
    about: "Σχετικά",
    siteName: "Fashion Boutique",
    copyright: "All rights reserved.",
    price: "Τιμή",
    stock: "Απόθεμα",
    sizeGuide: "Οδηγός μεγεθών",
    sizeGuideHelp: "Δεν είστε σίγουροι για το μέγεθος; Στείλτε μας το ύψος, το βάρος και το συνηθισμένο σας μέγεθος. Θα σας βοηθήσουμε.",
    selectSize: "Επιλέξτε πρώτα μέγεθος.",
    oneSize: "Ένα μέγεθος",
    whatsappAskProduct: "Προϊόν",
    whatsappAskSku: "SKU",
    whatsappAskSize: "Μέγεθος",
    whatsappCheckStore: "Είναι το \"{name}\" (SKU: {sku}) διαθέσιμο στο κατάστημά σας;",
    heroCTA: "Δείτε τα προϊόντα",
    heroWhatsApp: "Επικοινωνήστε στο WhatsApp",
    howToBuy: "Πώς να αγοράσετε",
    step1Title: "Περιηγηθείτε",
    step1Desc: "Δείτε τη συλλογή μας και επιλέξτε τα αγαπημένα σας.",
    step2Title: "Ρωτήστε μας",
    step2Desc: "Στείλτε μας WhatsApp για διαθεσιμότητα και μεγέθη.",
    step3Title: "Επισκεφθείτε μας",
    step3Desc: "Δοκιμάστε στο κατάστημά μας στην Αθήνα.",
    step4Title: "Skroutz",
    step4Desc: "Παραγγείλτε online μέσω Skroutz.",
    browseCollection: "Περιηγηθείτε στη συλλογή",
    whyUs: "Γιατί εμάς",
    whyLocal: "Τοπικό κατάστημα",
    whyLocalDesc: "Επισκεφθείτε το φυσικό μας κατάστημα στην Αθήνα.",
    whySkroutz: "Skroutz",
    whySkroutzDesc: "Τα προϊόντα μας είναι διαθέσιμα και μέσω Skroutz.",
    whyContact: "Εύκολη επικοινωνία",
    whyContactDesc: "Ρωτήστε μας μέσω WhatsApp ή Instagram.",
    purchaseNote: "Η αγορά ολοκληρώνεται μέσω Skroutz ή επικοινωνώντας με το κατάστημα.",
    purchaseContactNote: "Για διαθεσιμότητα και αγορά, επικοινωνήστε απευθείας με το κατάστημα.",
    details: "Λεπτομέρειες",
    inStockLabel: "Σε απόθεμα",
    outOfStockLabel: "Εκτός αποθέματος",
    brand: "Μάρκα",
    ean: "EAN",
    aiAssistant: "AI Βοηθός",
    aiPlaceholder: "Πείτε μας τι ψάχνετε...",
    aiProductPlaceholder: "Ρωτήστε για αυτό το προϊόν...",
    aiThinking: "Σκέφτομαι...",
    aiGreeting: "Γεια σας! Είμαι ο βοηθός αγορών. Πώς μπορώ να σας βοηθήσω;",
    askAi: "Ρώτησε τον AI βοηθό",
    whatsappContact: "Επικοινωνία μέσω WhatsApp",
    aiNeedHelp: "Χρειάζεστε βοήθεια; WhatsApp",
    aiProductLabel: "Ρωτάτε για αυτό το προϊόν",
    aiClear: "Καθαρισμός",
    aiSizeBtn: "Μέγεθος",
    aiSimilarBtn: "Παρόμοια",
    aiSummerBtn: "Καλοκαίρι",
    aiMaterialBtn: "Υλικό",
    aiSizePrompt: "Τι μέγεθος να επιλέξω για αυτό το προϊόν;",
    aiSimilarPrompt: "Υπάρχουν παρόμοια προϊόντα;",
    aiSummerPrompt: "Είναι αυτό το προϊόν κατάλληλο για το καλοκαίρι;",
    aiMaterialPrompt: "Τι υλικό έχει αυτό το προϊόν;"
  },
  en: {
    eyebrow: "Athens boutique",
    intro: "Selected fashion pieces, shoes, bags and accessories. Contact us for availability and sizing.",
    latest: "Latest products",
    latestText: "Newest pieces from our collection.",
    categoryIntro: "Browse our latest items in this category.",
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
    brandHeading: "Fashion Boutique",
    brandIntro: "Discover our collection of clothing, shoes and accessories designed for Mediterranean style.",
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
    storeDescription: "Greek fashion store based in Athens.",
    hours: "Hours",
    about: "About",
    siteName: "Fashion Boutique",
    copyright: "All rights reserved.",
    price: "Price",
    stock: "Stock",
    sizeGuide: "Size guide",
    sizeGuideHelp: "Not sure about your size? Send us your height, weight and usual size. We will help you choose.",
    selectSize: "Please select a size first.",
    oneSize: "One size",
    whatsappAskProduct: "Product",
    whatsappAskSku: "SKU",
    whatsappAskSize: "Size",
    whatsappCheckStore: "Is \"{name}\" (SKU: {sku}) available in your store?",
    heroCTA: "View products",
    heroWhatsApp: "Ask on WhatsApp",
    howToBuy: "How to buy",
    step1Title: "Browse",
    step1Desc: "Explore our collection and pick your favorites.",
    step2Title: "Ask us",
    step2Desc: "WhatsApp us for availability and sizes.",
    step3Title: "Visit us",
    step3Desc: "Try on at our boutique in Athens.",
    step4Title: "Skroutz",
    step4Desc: "Order online via Skroutz.",
    browseCollection: "Browse collection",
    whyUs: "Why choose us",
    whyLocal: "Local Athens Store",
    whyLocalDesc: "Visit our physical boutique in Athens.",
    whySkroutz: "Skroutz Ready",
    whySkroutzDesc: "Our products are also available through Skroutz.",
    whyContact: "Easy Contact",
    whyContactDesc: "Ask us anything through WhatsApp or Instagram.",
    purchaseNote: "Purchase is completed through Skroutz or by contacting the store.",
    purchaseContactNote: "Contact the store directly for availability and purchase.",
    details: "Details",
    inStockLabel: "In stock",
    outOfStockLabel: "Out of stock",
    brand: "Brand",
    ean: "EAN",
    aiAssistant: "AI Assistant",
    aiPlaceholder: "Tell me what you are looking for...",
    aiProductPlaceholder: "Ask about this product...",
    aiThinking: "Thinking...",
    aiGreeting: "Hi! I'm your shopping assistant. How can I help you?",
    askAi: "Ask AI Assistant",
    whatsappContact: "Contact store on WhatsApp",
    aiNeedHelp: "Need staff help? WhatsApp",
    aiProductLabel: "You are asking about this product",
    aiClear: "Clear",
    aiSizeBtn: "Size advice",
    aiSimilarBtn: "Similar",
    aiSummerBtn: "Summer",
    aiMaterialBtn: "Material",
    aiSizePrompt: "What size should I choose for this product?",
    aiSimilarPrompt: "Do you have similar products?",
    aiSummerPrompt: "Is this product suitable for summer?",
    aiMaterialPrompt: "What is the material of this product?"
  }
};
