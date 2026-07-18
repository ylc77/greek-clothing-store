import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { invalidateCategoriesCache, invalidateProductsCache } from "@/lib/cache";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "products:read");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "No admin client" }, { status: 500 });

  const [cats, subs] = await Promise.all([
    supabase.from("product_categories").select("*").order("sort_order"),
    supabase.from("product_subcategories").select("*").order("sort_order"),
  ]);

  return NextResponse.json({ categories: cats.data || [], subcategories: subs.data || [] });
}

export async function PUT(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "categories:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "No admin client" }, { status: 500 });

  const body = await request.json();
  const { categories, subcategories } = body as {
    categories?: Array<Record<string, unknown>>;
    subcategories?: Array<Record<string, unknown>>;
  };

  if (categories) {
    for (const c of categories) {
      const payload = { slug: c.slug, name_cn: c.name_cn, name_en: c.name_en, name_gr: c.name_gr, image_url: c.image_url, sort_order: c.sort_order, is_active: c.is_active };
      await (supabase as any).from("product_categories").upsert(c.id ? { id: c.id, ...payload } : payload, { onConflict: c.id ? "id" : "slug" });
    }
  }
  if (subcategories) {
    for (const s of subcategories) {
      const payload = { category_id: s.category_id, slug: s.slug, name_cn: s.name_cn, name_en: s.name_en, name_gr: s.name_gr, sort_order: s.sort_order, is_active: s.is_active };
      await (supabase as any).from("product_subcategories").upsert(s.id ? { id: s.id, ...payload } : payload, { onConflict: s.id ? "id" : "category_id,slug" });
    }
  }

  invalidateCategoriesCache();
  invalidateProductsCache();

  return NextResponse.json({ ok: true });
}
