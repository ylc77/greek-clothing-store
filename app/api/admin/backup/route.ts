import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

const csvFields = [
  "sku",
  "name_cn",
  "description_cn",
  "name_en",
  "description_en",
  "name_gr",
  "description_gr",
  "category",
  "subcategory",
  "price",
  "stock",
  "sizes",
  "size_system",
  "size_stock",
  "variant_supplier_skus",
  "variant_cost_prices",
  "variant_reorder_levels",
  "image_url",
  "image_urls",
  "brand",
  "supplier_id",
  "supplier_style_code",
  "barcode",
  "ean",
  "mpn",
  "vat",
  "color",
  "skroutz_url",
  "is_active",
  "material",
  "fiber_composition_gr",
  "fiber_composition_en",
  "care_instructions_gr",
  "care_instructions_en",
  "country_of_origin",
  "manufacturer_name",
  "manufacturer_contact",
  "eu_responsible_person",
  "product_safety_notes_gr",
  "product_safety_notes_en",
  "fit_type",
  "ai_keywords",
  "style_tags",
  "size_chart",
  "material_verified",
];

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '""';

  let str: string;
  if (Array.isArray(value)) {
    str = value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .join(",");
  } else if (typeof value === "object") {
    str = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}:${Number(item) || 0}`)
      .join(",");
  } else {
    str = String(value);
  }

  return `"${str.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "backup:read"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isFeatureEnabled("backup_tools"))) return featureDisabledResponse("backup_tools");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Admin client not configured" }, { status: 500 });
  }

  const [{ data }, { data: variants }] = await Promise.all([
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("product_variants").select("product_id, size, supplier_sku, cost_price, reorder_level"),
  ]);

  const products = (data || []) as Product[];
  const variantRows = (variants || []) as unknown as Array<{
    product_id: number | string;
    size: string | null;
    supplier_sku: string | null;
    cost_price: number | null;
    reorder_level: number | null;
  }>;
  const rows = products.map((p) => {
    const productVariants = variantRows.filter((variant) => Number(variant.product_id) === Number(p.id));
    const virtualFields: Record<string, unknown> = {
      variant_supplier_skus: Object.fromEntries(productVariants.filter(v => v.supplier_sku).map(v => [v.size || "ONE SIZE", v.supplier_sku])),
      variant_cost_prices: Object.fromEntries(productVariants.filter(v => v.cost_price !== null).map(v => [v.size || "ONE SIZE", v.cost_price])),
      variant_reorder_levels: Object.fromEntries(productVariants.filter(v => v.reorder_level !== null).map(v => [v.size || "ONE SIZE", v.reorder_level])),
    };
    return csvFields.map((field) => csvCell(virtualFields[field] ?? (p as Record<string, unknown>)[field])).join(",");
  });

  const csv = "\uFEFF" + csvFields.join(",") + "\n" + rows.join("\n") + "\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
