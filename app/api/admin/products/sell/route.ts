import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid, productForForm } from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function normalizeSize(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function sizeStockRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, qty] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(qty);
    if (Number.isFinite(parsed)) out[key.toUpperCase()] = Math.max(0, Math.trunc(parsed));
  }
  return Object.keys(out).length > 0 ? out : null;
}

function totalSizeStock(stock: Record<string, number>) {
  return Object.values(stock).reduce((sum, qty) => sum + Math.max(0, Math.trunc(qty)), 0);
}

export async function POST(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const size = normalizeSize(payload.size);
  const quantity = Math.max(1, Math.trunc(Number(payload.quantity) || 1));
  const autoDeactivate = payload.autoDeactivate !== false;

  if (!sku) return NextResponse.json({ error: "SKU is required" }, { status: 400 });

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .maybeSingle();

  if (productError) return NextResponse.json({ error: productError.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const rawProduct = product as Product & { size_stock?: Record<string, number> | null };
  const currentSizeStock = sizeStockRecord(rawProduct.size_stock);
  const update: Record<string, unknown> = {};
  let soldSize = size;

  if (currentSizeStock) {
    const keys = Object.keys(currentSizeStock);
    if (!soldSize && keys.length === 1) soldSize = keys[0];
    if (!soldSize || !(soldSize in currentSizeStock)) {
      return NextResponse.json({ error: "请选择有效尺码后再扣库存" }, { status: 400 });
    }

    const current = currentSizeStock[soldSize];
    if (current < quantity) {
      return NextResponse.json({ error: `${soldSize} 库存不足，当前只有 ${current} 件` }, { status: 400 });
    }

    currentSizeStock[soldSize] = current - quantity;
    const total = totalSizeStock(currentSizeStock);
    update.size_stock = currentSizeStock;
    update.stock = total;
    update.sizes = Object.keys(currentSizeStock).join(",");
    if (autoDeactivate && total <= 0) update.is_active = false;
  } else {
    const current = Math.max(0, Math.trunc(Number(rawProduct.stock) || 0));
    if (current < quantity) {
      return NextResponse.json({ error: `库存不足，当前只有 ${current} 件` }, { status: 400 });
    }
    const total = current - quantity;
    update.stock = total;
    if (autoDeactivate && total <= 0) update.is_active = false;
  }

  const { data, error } = await supabase
    .from("products")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(update as any)
    .eq("id", rawProduct.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateProductsCache(rawProduct.sku);

  return NextResponse.json({
    ok: true,
    sold: quantity,
    size: soldSize || null,
    product: productForForm(data as Product),
  });
}
