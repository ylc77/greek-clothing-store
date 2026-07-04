import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermission } from "@/lib/admin-auth";
import { getMainInventoryLocation } from "@/lib/erp-inventory";
import { getSupabaseAdminClient } from "@/lib/supabase";

type VariantRow = {
  id: string;
  product_id: number | string;
  variant_sku: string | null;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: number | string | null;
  active: boolean | null;
  created_at?: string | null;
};

type ProductRow = {
  id: number | string;
  sku: string | null;
  name_cn: string | null;
  name_en: string | null;
  name_gr: string | null;
  price: number | string | null;
  image_url: string | null;
  is_active: boolean | null;
};

type BalanceRow = {
  variant_id: string;
  quantity_on_hand: number | string | null;
  quantity_reserved: number | string | null;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function quantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

function productName(product: ProductRow) {
  return (
    text(product.name_cn) ||
    text(product.name_en) ||
    text(product.name_gr) ||
    text(product.sku)
  );
}

function matchScore(q: string, row: { barcode: string; variant_sku: string; product_sku: string; name: string }) {
  if (!q) return 100;
  const needle = q.toLowerCase();
  if (row.barcode.toLowerCase() === needle) return 0;
  if (row.variant_sku.toLowerCase() === needle) return 1;
  if (row.product_sku.toLowerCase() === needle) return 2;
  if (row.barcode.toLowerCase().includes(needle)) return 3;
  if (row.variant_sku.toLowerCase().includes(needle)) return 4;
  if (row.product_sku.toLowerCase().includes(needle)) return 5;
  if (row.name.toLowerCase().includes(needle)) return 6;
  return 99;
}

export async function GET(request: NextRequest) {
  if (!adminRequestHasPermission(request, "pos:read")) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const fetchLimit = q ? 1000 : 20;

  try {
    const location = await getMainInventoryLocation();
    const { data: variants, error: variantsError } = await (supabase as any)
      .from("product_variants")
      .select("id, product_id, variant_sku, barcode, size, color, price, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);

    if (variantsError) {
      return NextResponse.json({ error: variantsError.message }, { status: 500 });
    }

    const variantRows = ((variants || []) as VariantRow[]).filter((variant) => variant.active !== false);
    const productIds = Array.from(new Set(variantRows.map((variant) => Number(variant.product_id)).filter(Number.isFinite)));
    const productMap = new Map<number, ProductRow>();

    if (productIds.length > 0) {
      const { data: products, error: productsError } = await (supabase as any)
        .from("products")
        .select("id, sku, name_cn, name_en, name_gr, price, image_url, is_active")
        .in("id", productIds);

      if (productsError) {
        return NextResponse.json({ error: productsError.message }, { status: 500 });
      }

      for (const product of (products || []) as ProductRow[]) {
        productMap.set(Number(product.id), product);
      }
    }

    const variantIds = variantRows.map((variant) => variant.id);
    const balanceMap = new Map<string, BalanceRow>();
    if (variantIds.length > 0) {
      const { data: balances, error: balancesError } = await (supabase as any)
        .from("inventory_balances")
        .select("variant_id, quantity_on_hand, quantity_reserved")
        .eq("location_id", location.id)
        .in("variant_id", variantIds);

      if (balancesError) {
        return NextResponse.json({ error: balancesError.message }, { status: 500 });
      }

      for (const balance of (balances || []) as BalanceRow[]) {
        balanceMap.set(String(balance.variant_id), balance);
      }
    }

    const items = variantRows
      .map((variant) => {
        const product = productMap.get(Number(variant.product_id));
        if (!product || product.is_active === false) return null;

        const balance = balanceMap.get(variant.id);
        const quantityOnHand = quantity(balance?.quantity_on_hand);
        const quantityReserved = quantity(balance?.quantity_reserved);
        const quantityAvailable = Math.max(0, quantityOnHand - quantityReserved);
        const name = productName(product);
        const row = {
          product_id: Number(product.id),
          variant_id: variant.id,
          product_sku: text(product.sku),
          variant_sku: text(variant.variant_sku),
          barcode: text(variant.barcode),
          name,
          size: text(variant.size) || null,
          color: text(variant.color) || null,
          price: money(variant.price ?? product.price),
          quantity_on_hand: quantityOnHand,
          quantity_reserved: quantityReserved,
          quantity_available: quantityAvailable,
          product_active: true,
          variant_active: true,
          image_url: text(product.image_url),
          outOfStock: quantityAvailable <= 0,
        };

        const score = matchScore(q, row);
        if (q && score >= 99) return null;
        return { ...row, _score: score };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => {
        const left = a as { _score: number; variant_sku: string };
        const right = b as { _score: number; variant_sku: string };
        return left._score - right._score || left.variant_sku.localeCompare(right.variant_sku);
      })
      .slice(0, 20)
      .map((scoredItem) => {
        const { _score, ...item } = scoredItem;
        return item;
      });

    return NextResponse.json({ ok: true, items, total: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search POS products.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
