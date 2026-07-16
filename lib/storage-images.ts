import { createHash } from "node:crypto";
import type { getSupabaseAdminClient } from "./supabase";

export const productImagesBucket = "product-images";
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categoryIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export function storageSkuSegment(sku: string) {
  const readable = sku.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "sku";
  const digest = createHash("sha256").update(sku, "utf8").digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

function assertOperationId(operationId: string) {
  if (!operationIdPattern.test(operationId)) throw new Error("Storage operation ID must be a UUID.");
}

export function normalizeStorageObjectPath(path: string) {
  const value = path.trim();
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("//") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Storage object path is invalid.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("Storage object path encoding is invalid.");
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Storage object path traversal is not allowed.");
  }
  return decoded;
}

export function productStoragePrefix(productId: number, sku: string) {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error("Product ID is invalid.");
  return `products/${productId}/${storageSkuSegment(sku)}`;
}

export function productStoragePath(
  productId: number,
  sku: string,
  kind: "main" | "gallery" | "ai",
  operationId: string,
) {
  assertOperationId(operationId);
  return `${productStoragePrefix(productId, sku)}/${kind}/${operationId}.webp`;
}

export function settingsStoragePath(target: "logo" | "hero", operationId: string) {
  if (target !== "logo" && target !== "hero") throw new Error("Store image target must be logo or hero.");
  assertOperationId(operationId);
  return `store/${target}/${operationId}.webp`;
}

export function categoryStoragePath(categoryId: string, operationId: string) {
  if (!categoryIdPattern.test(categoryId)) throw new Error("Category ID is invalid.");
  assertOperationId(operationId);
  return `categories/${categoryId}/${operationId}.webp`;
}

export function pathBelongsToProduct(path: string, productId: number, sku: string) {
  try {
    const normalized = normalizeStorageObjectPath(path);
    const prefix = `${productStoragePrefix(productId, sku)}/`;
    return normalized.startsWith(prefix);
  } catch {
    return false;
  }
}

export function configuredStorageOrigin() {
  const value = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function storagePathFromPublicUrl(url: string | null | undefined, expectedOrigin = configuredStorageOrigin()) {
  if (!url) {
    return null;
  }
  if (/%2e|%2f|%5c/i.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!expectedOrigin || parsed.origin !== expectedOrigin) return null;
  const marker = `/storage/v1/object/public/${productImagesBucket}/`;
  if (!parsed.pathname.startsWith(marker)) return null;
  try {
    return normalizeStorageObjectPath(parsed.pathname.slice(marker.length));
  } catch {
    return null;
  }
}

export async function listManagedProductStoragePaths(supabase: SupabaseAdminClient, productId: number, sku: string) {
  const prefix = productStoragePrefix(productId, sku);
  const paths: string[] = [];
  for (const kind of ["main", "gallery", "ai"] as const) {
    const { data, error } = await supabase.storage.from(productImagesBucket).list(`${prefix}/${kind}`, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(error.message);
    for (const item of data || []) {
      if (item.name && !item.name.includes("/")) paths.push(`${prefix}/${kind}/${item.name}`);
    }
  }
  return Array.from(new Set(paths.map(normalizeStorageObjectPath)));
}
