import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";
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
  "size_stock",
  "image_url",
  "image_urls",
  "brand",
  "barcode",
  "vat",
  "color",
  "skroutz_url",
  "is_active",
  "material",
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
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Admin client not configured" }, { status: 500 });
  }

  const { data } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  const products = (data || []) as Product[];
  const rows = products.map((p) =>
    csvFields.map((field) => csvCell((p as Record<string, unknown>)[field])).join(","),
  );

  const csv = "\uFEFF" + csvFields.join(",") + "\n" + rows.join("\n") + "\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
