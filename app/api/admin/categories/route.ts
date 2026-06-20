import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauth() { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

export async function GET(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauth();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "No admin client" }, { status: 500 });

  const [cats, subs] = await Promise.all([
    supabase.from("product_categories").select("*").order("sort_order"),
    supabase.from("product_subcategories").select("*").order("sort_order"),
  ]);

  return NextResponse.json({ categories: cats.data || [], subcategories: subs.data || [] });
}

export async function PUT(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauth();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "No admin client" }, { status: 500 });

  const body = await request.json();
  const { categories, subcategories } = body as {
    categories?: Array<Record<string, unknown>>;
    subcategories?: Array<Record<string, unknown>>;
  };

  if (categories) {
    for (const c of categories) {
      await (supabase as any).from("product_categories").upsert({ id: c.id, slug: c.slug, name_cn: c.name_cn, name_en: c.name_en, name_gr: c.name_gr, image_url: c.image_url, sort_order: c.sort_order, is_active: c.is_active }, { onConflict: "id" });
    }
  }
  if (subcategories) {
    for (const s of subcategories) {
      await (supabase as any).from("product_subcategories").upsert({ id: s.id, category_id: s.category_id, slug: s.slug, name_cn: s.name_cn, name_en: s.name_en, name_gr: s.name_gr, sort_order: s.sort_order, is_active: s.is_active }, { onConflict: "id" });
    }
  }

  return NextResponse.json({ ok: true });
}
