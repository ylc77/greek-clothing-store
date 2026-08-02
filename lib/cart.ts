export type CartItem = {
  productSku: string;
  nameEn: string;
  nameGr: string;
  size: string;
  color: string;
  quantity: number;
  availableQuantity: number;
  unitPrice: number;
  imageUrl: string;
};

export const CART_STORAGE_KEY = "clothing-store:cart:v1";
export const CART_MAX_LINES = 25;
export const CART_MAX_QUANTITY_PER_LINE = 20;

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function cartItemKey(item: Pick<CartItem, "productSku" | "size" | "color">) {
  return [item.productSku, item.size || "ONE SIZE", item.color || ""]
    .map(value => value.trim().toLocaleLowerCase())
    .join("\u001f");
}

export function normalizeCartItem(value: unknown): CartItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<CartItem>;
  const productSku = cleanText(row.productSku, 200);
  const size = cleanText(row.size, 80) || "ONE SIZE";
  const quantity = Math.trunc(Number(row.quantity));
  const availableQuantity = Math.max(0, Math.trunc(Number(row.availableQuantity)));
  const unitPrice = Math.round(Number(row.unitPrice) * 100) / 100;
  if (!productSku || !Number.isFinite(unitPrice) || unitPrice < 0 || quantity < 1 || quantity > CART_MAX_QUANTITY_PER_LINE) return null;
  return {
    productSku,
    nameEn: cleanText(row.nameEn, 300) || productSku,
    nameGr: cleanText(row.nameGr, 300) || cleanText(row.nameEn, 300) || productSku,
    size,
    color: cleanText(row.color, 120),
    quantity: Math.min(quantity, Math.max(1, availableQuantity)),
    availableQuantity,
    unitPrice,
    imageUrl: cleanText(row.imageUrl, 2_000),
  };
}

export function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, CartItem>();
  for (const entry of value.slice(0, CART_MAX_LINES * 2)) {
    const item = normalizeCartItem(entry);
    if (!item || item.availableQuantity < 1) continue;
    const key = cartItemKey(item);
    const existing = result.get(key);
    result.set(key, existing
      ? { ...item, quantity: Math.min(existing.quantity + item.quantity, item.availableQuantity, CART_MAX_QUANTITY_PER_LINE) }
      : item);
    if (result.size >= CART_MAX_LINES) break;
  }
  return Array.from(result.values());
}

export function cartTotals(items: CartItem[]) {
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
  return { lines: items.length, quantity, subtotal };
}

export function addCartItem(items: CartItem[], next: CartItem) {
  const normalized = normalizeCartItem(next);
  if (!normalized || normalized.availableQuantity < 1) return items;
  const key = cartItemKey(normalized);
  const current = items.find(item => cartItemKey(item) === key);
  if (!current && items.length >= CART_MAX_LINES) return items;
  return normalizeCart(current
    ? items.map(item => cartItemKey(item) === key
      ? { ...item, ...normalized, quantity: Math.min(item.quantity + normalized.quantity, normalized.availableQuantity, CART_MAX_QUANTITY_PER_LINE) }
      : item)
    : [...items, normalized]);
}

export function updateCartQuantity(items: CartItem[], key: string, quantity: number) {
  if (quantity <= 0) return items.filter(item => cartItemKey(item) !== key);
  return items.map(item => cartItemKey(item) === key
    ? { ...item, quantity: Math.min(Math.max(1, Math.trunc(quantity)), item.availableQuantity, CART_MAX_QUANTITY_PER_LINE) }
    : item);
}
