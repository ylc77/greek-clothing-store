export type SkroutzProductRow = {
  id: number | string;
  sku: string;
  name_gr: string | null;
  name_en: string | null;
  description_gr: string | null;
  description_en: string | null;
  category: string | null;
  subcategory: string | null;
  price: number | string;
  image_url: string | null;
  image_urls: string[] | string | null;
  additional_image_urls: string | null;
  image_width: number | string | null;
  image_height: number | string | null;
  brand: string | null;
  ean: string | null;
  vat: number | string | null;
  color: string | null;
  mpn: string | null;
  availability: string | null;
  country_of_origin: string | null;
  category_path_en: string | null;
  is_active: boolean | null;
  created_at: string;
};

export type SkroutzVariantRow = {
  id: string;
  product_id: number | string;
  variant_sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: number | string | null;
  active: boolean;
};

export type SkroutzBalanceRow = {
  variant_id: string;
  location_code: string;
  quantity_on_hand: number | string;
  quantity_reserved: number | string;
};

export type SkroutzFeedVariation = {
  id: string;
  availability: string;
  size: string;
  quantity: number;
  price: number;
  link: string;
  mpn: string;
  ean: string | null;
};

export type SkroutzFeedProduct = {
  id: string;
  name: string;
  description: string;
  link: string;
  image: string;
  additionalImages: string[];
  category: string;
  price: number;
  vat: number;
  availability: string;
  manufacturer: string;
  mpn: string;
  ean: string;
  size: string;
  color: string;
  countryOfOrigin: string;
  quantity: number;
  variants: SkroutzFeedVariation[];
};

const CATEGORY_PATHS: Record<string, string> = {
  men: "Men",
  women: "Women",
  shoes: "Shoes",
  bags: "Bags",
  luggage: "Luggage",
  hats: "Hats",
  jewelry: "Jewelry",
  other: "Other",
};

const SUBCATEGORY_PATHS: Record<string, string> = {
  tshirts: "T-Shirts",
  shirts: "Shirts",
  hoodies: "Hoodies",
  jackets: "Jackets",
  trousers: "Trousers",
  jeans: "Jeans",
  shorts: "Shorts",
  dresses: "Dresses",
  tops: "Tops",
  skirts: "Skirts",
  sneakers: "Sneakers",
  boots: "Boots",
  sandals: "Sandals",
  heels: "Heels",
  handbags: "Handbags",
  backpacks: "Backpacks",
  wallets: "Wallets",
  suitcases: "Suitcases",
  travel_bags: "Travel Bags",
  caps: "Caps",
  beanies: "Beanies",
  necklaces: "Necklaces",
  bracelets: "Bracelets",
  earrings: "Earrings",
  rings: "Rings",
  accessories: "Accessories",
};

const FASHION_CATEGORIES = new Set(["men", "women", "shoes", "bags", "hats", "jewelry"]);
const SIZED_CATEGORIES = new Set(["men", "women", "shoes"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeQuantity(value: unknown) {
  return Math.max(0, Math.min(10_000_000, Math.trunc(finiteNumber(value))));
}

function isHttpsUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

function isTestSku(value: unknown) {
  const sku = text(value).toUpperCase();
  return sku === "TEST"
    || sku === "DEMO"
    || sku.startsWith("TEST-")
    || sku.startsWith("TEST_")
    || sku.startsWith("DEMO-")
    || sku.startsWith("DEMO_");
}

function validEan(value: unknown) {
  return /^(?:\d{8}|\d{13})$/.test(text(value));
}

function getAdditionalImages(product: SkroutzProductRow) {
  const imageUrls = Array.isArray(product.image_urls)
    ? product.image_urls
    : text(product.image_urls).split(/[\r\n,]+/);
  const legacyUrls = text(product.additional_image_urls).split(/[\r\n,]+/);
  return Array.from(new Set([...imageUrls, ...legacyUrls].map(text)))
    .filter((url) => url !== text(product.image_url) && isHttpsUrl(url))
    .slice(0, 15);
}

function productCategory(product: SkroutzProductRow) {
  const configured = text(product.category_path_en);
  if (configured) return configured;
  const category = text(product.category).toLowerCase();
  const subcategory = text(product.subcategory).toLowerCase();
  const parent = CATEGORY_PATHS[category] || text(product.category);
  const child = SUBCATEGORY_PATHS[subcategory] || text(product.subcategory);
  return child ? `${parent} > ${child}` : parent;
}

function productLink(siteOrigin: string, sku: string) {
  return `${siteOrigin.replace(/\/$/, "")}/product/${encodeURIComponent(sku)}`;
}

export function stripInvalidXmlCharacters(value: string) {
  return value.replace(
    /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
    "",
  );
}

export function xmlEscape(value: string | number | null | undefined) {
  return stripInvalidXmlCharacters(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function field(value: unknown, maxLength: number) {
  return stripInvalidXmlCharacters(text(value)).slice(0, maxLength);
}

function formatPrice(value: unknown, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return Math.max(0, number).toFixed(2);
}

function formatCreatedAt(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function optionalTag(tag: string, value: string | number | null | undefined, indent = "      ") {
  if (value === null || value === undefined || value === "") return "";
  return `${indent}<${tag}>${xmlEscape(value)}</${tag}>\n`;
}

export function assembleSkroutzFeedProducts(
  products: SkroutzProductRow[],
  variants: SkroutzVariantRow[],
  balances: SkroutzBalanceRow[],
  minStock = 1,
  siteOrigin = "https://example.invalid",
  _fallbackBrand = "Fashion Boutique",
) {
  if (!isHttpsUrl(siteOrigin)) return [];
  const requiredStock = Math.max(1, Math.trunc(finiteNumber(minStock, 1)));
  const mainStoreBalances = new Map<string, number>();
  for (const balance of balances) {
    if (text(balance.location_code).toUpperCase() !== "MAIN_STORE") continue;
    const available = Math.max(
      0,
      safeQuantity(balance.quantity_on_hand) - safeQuantity(balance.quantity_reserved),
    );
    mainStoreBalances.set(text(balance.variant_id), available);
  }

  const variantsByProduct = new Map<string, SkroutzVariantRow[]>();
  for (const variant of variants) {
    if (!variant.active) continue;
    const productId = String(variant.product_id);
    const current = variantsByProduct.get(productId) || [];
    current.push(variant);
    variantsByProduct.set(productId, current);
  }

  const result: SkroutzFeedProduct[] = [];
  for (const product of products) {
    const sku = field(product.sku, 200);
    const categoryKey = text(product.category).toLowerCase();
    const sized = SIZED_CATEGORIES.has(categoryKey);
    const fashion = FASHION_CATEGORIES.has(categoryKey);
    const rawName = field(product.name_en, 300);
    const description = field(product.description_en, 10_000);
    const image = field(product.image_url, 400);
    const ean = field(product.ean, 13);
    const mpn = field(product.mpn, 80);
    const color = field(product.color, 100);
    const brand = field(product.brand, 100);
    const name = field(
      rawName && brand && !rawName.toLocaleLowerCase("en").includes(brand.toLocaleLowerCase("en"))
        ? `${brand} ${rawName}`
        : rawName,
      300,
    );
    const category = field(productCategory(product), 250);
    const price = finiteNumber(product.price);
    const link = productLink(siteOrigin, sku);
    const additionalImages = getAdditionalImages(product);

    if (product.is_active === false
      || !sku
      || isTestSku(sku)
      || !name
      || !description
      || !category
      || price <= 0
      || !brand
      || !mpn
      || !validEan(ean)
      || !isHttpsUrl(image)
      || !isHttpsUrl(link)
      || Math.max(finiteNumber(product.image_width), finiteNumber(product.image_height)) <= 1000
      || (fashion && !color)
      || (sized && additionalImages.length === 0)) {
      continue;
    }

    const productVariants = variantsByProduct.get(String(product.id)) || [];
    const feedVariants: SkroutzFeedVariation[] = [];
    let totalAvailable = 0;
    for (const variant of productVariants) {
      const available = mainStoreBalances.get(text(variant.id)) || 0;
      totalAvailable += available;
      const size = field(variant.size, 64);
      if (!sized || available <= 0 || !size) continue;
      const variantId = field(variant.variant_sku, 200);
      if (!variantId) continue;
      const barcode = field(variant.barcode, 13);
      feedVariants.push({
        id: variantId,
        availability: field(product.availability || "In stock", 60),
        size,
        quantity: available,
        price: finiteNumber(variant.price, price) || price,
        link,
        mpn,
        ean: validEan(barcode) ? barcode : null,
      });
    }

    if (totalAvailable < requiredStock || (sized && feedVariants.length === 0)) continue;
    const availableSizes = feedVariants.map((variant) => variant.size);
    result.push({
      id: sku,
      name,
      description,
      link,
      image,
      additionalImages,
      category,
      price,
      vat: finiteNumber(product.vat, 24),
      availability: field(product.availability || "In stock", 60),
      manufacturer: brand,
      mpn,
      ean,
      size: field(availableSizes.join(","), 500),
      color,
      countryOfOrigin: field(product.country_of_origin, 255),
      quantity: totalAvailable,
      variants: feedVariants,
    });
  }
  return result;
}

export function buildSkroutzFeed(
  products: SkroutzFeedProduct[],
  _fallbackBrand: string,
  createdAt = new Date(),
) {
  const rows = products.map((product) => {
    const additionalImages = product.additionalImages
      .map((url) => `      <additional_imageurl>${xmlEscape(url)}</additional_imageurl>`)
      .join("\n");
    const variations = product.variants.length > 0
      ? `      <variations>\n${product.variants.map((variant) => `        <variation>\n          <variationid>${xmlEscape(variant.id)}</variationid>\n          <availability>${xmlEscape(variant.availability)}</availability>\n          <size>${xmlEscape(variant.size)}</size>\n          <quantity>${variant.quantity}</quantity>\n          <price>${formatPrice(variant.price)}</price>\n          <link>${xmlEscape(variant.link)}</link>\n          <mpn>${xmlEscape(variant.mpn)}</mpn>\n${optionalTag("ean", variant.ean, "          ")}        </variation>`).join("\n")}\n      </variations>\n`
      : "";

    return `    <product>\n      <id>${xmlEscape(product.id)}</id>\n      <uid>${xmlEscape(product.id)}</uid>\n      <name>${xmlEscape(product.name)}</name>\n      <link>${xmlEscape(product.link)}</link>\n      <image>${xmlEscape(product.image)}</image>\n${additionalImages ? `${additionalImages}\n` : ""}      <category>${xmlEscape(product.category)}</category>\n      <price_with_vat>${formatPrice(product.price)}</price_with_vat>\n      <price>${formatPrice(product.price)}</price>\n      <vat>${formatPrice(product.vat, 24)}</vat>\n      <instock>Y</instock>\n      <availability>${xmlEscape(product.availability)}</availability>\n      <manufacturer>${xmlEscape(product.manufacturer)}</manufacturer>\n      <mpn>${xmlEscape(product.mpn)}</mpn>\n      <ean>${xmlEscape(product.ean)}</ean>\n${optionalTag("size", product.size)}${optionalTag("color", product.color)}${optionalTag("country_of_origin", product.countryOfOrigin)}      <quantity>${product.quantity}</quantity>\n      <description>${xmlEscape(product.description)}</description>\n${variations}    </product>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<mywebstore>\n  <created_at>${formatCreatedAt(createdAt)}</created_at>\n  <products>\n${rows}\n  </products>\n</mywebstore>`;
}
