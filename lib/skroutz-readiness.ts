import { getTotalStock } from "@/lib/product-stock";

type SkroutzProductLike = {
  name_gr?: string | null;
  name_en?: string | null;
  name_cn?: string | null;
  description_gr?: string | null;
  description_en?: string | null;
  description_cn?: string | null;
  category?: string | null;
  price: number;
  stock: number;
  size_stock?: Record<string, number> | null;
  sizes?: string | null;
  image_url?: string | null;
  image_urls?: string[] | string | null;
  additional_image_urls?: string | null;
  mpn?: string | null;
  ean?: string | null;
  color?: string | null;
};

export type SkroutzIssueCode =
  | "name"
  | "description"
  | "price"
  | "stock"
  | "image"
  | "additional_images"
  | "mpn"
  | "ean"
  | "color"
  | "sizes";

export type SkroutzIssue = { code: SkroutzIssueCode; label: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return false;
  try { const url = new URL(raw); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

export function isSkroutzFashionProduct(product: SkroutzProductLike) {
  return ["men", "women", "shoes", "bags", "hats", "jewelry"].includes(text(product.category).toLowerCase());
}

export function isSkroutzSizedProduct(product: SkroutzProductLike) {
  return ["men", "women", "shoes"].includes(text(product.category).toLowerCase());
}

export function validSkroutzEan(value: unknown) {
  const ean = text(value);
  return /^\d{8}$|^\d{12,14}$/.test(ean);
}

export function skroutzReadinessIssues(product: SkroutzProductLike, minStock = 1): SkroutzIssue[] {
  const issues: SkroutzIssue[] = [];
  if (!text(product.name_gr) && !text(product.name_en) && !text(product.name_cn)) issues.push({ code: "name", label: "缺商品名称" });
  if (!text(product.description_gr) && !text(product.description_en) && !text(product.description_cn)) issues.push({ code: "description", label: "缺商品描述" });
  if (!(Number(product.price) > 0)) issues.push({ code: "price", label: "售价必须大于 0" });
  if (getTotalStock(product) < Math.max(1, Math.trunc(minStock))) issues.push({ code: "stock", label: "库存不足" });
  if (!isHttpUrl(product.image_url)) issues.push({ code: "image", label: "缺公网主图" });
  const extraImages = [
    ...(Array.isArray(product.image_urls)
      ? product.image_urls
      : text(product.image_urls).split(/[\r\n,]+/)),
    ...text(product.additional_image_urls).split(/[\r\n,]+/),
  ].filter(isHttpUrl).filter((url) => url !== text(product.image_url));
  if (isSkroutzSizedProduct(product) && extraImages.length === 0) issues.push({ code: "additional_images", label: "有尺码的服装缺附加图片" });
  if (!text(product.mpn)) issues.push({ code: "mpn", label: "缺真实 MPN" });
  if (!validSkroutzEan(product.ean)) issues.push({ code: "ean", label: "缺有效真实 EAN" });
  if (isSkroutzFashionProduct(product) && !text(product.color)) issues.push({ code: "color", label: "服装类缺颜色" });
  if (isSkroutzSizedProduct(product) && !text(product.sizes)) issues.push({ code: "sizes", label: "服装/鞋类缺尺码" });
  return issues;
}

export function normalizeSkroutzSizes(value: string | null | undefined) {
  return text(value)
    .split(",")
    .map((size) => size.trim().replace(/^EU\s+/i, ""))
    .map((size) => /^ONE\s*SIZE$/i.test(size) ? "One Size" : size)
    .filter(Boolean)
    .join(",");
}
