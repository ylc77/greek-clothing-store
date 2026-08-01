import { NextRequest } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure, adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import {
  CategoryCatalogInputError,
  parseCategoryCatalogMutation,
} from "@/lib/category-catalog";
import { invalidateCategoriesCache, invalidateProductsCache } from "@/lib/cache";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const CATEGORY_SELECT = "id,slug,name_cn,name_en,name_gr,image_url,sort_order,is_active,created_at,updated_at";
const SUBCATEGORY_SELECT = "id,category_id,slug,name_cn,name_en,name_gr,sort_order,is_active,created_at,updated_at";

async function requireCategoryAccess(request: NextRequest, permission: "products:read" | "categories:write") {
  const authorization = await authorizeAdminRequest(request, permission);
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("product_management"))) {
    return applyAdminPrivateCache(featureDisabledResponse("product_management"));
  }
  return null;
}

function unavailable() {
  return adminPrivateJson(
    { error: "分类数据暂时不可用，请稍后重试。", code: "CATEGORY_DATA_UNAVAILABLE" },
    { status: 503 },
  );
}

function databaseError(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";

  if (code === "PGRST202" || code === "42883" || message.includes("category_catalog_apply_rpc")) {
    return adminPrivateJson(
      { error: "分类事务功能尚未部署，当前保存已安全阻止。", code: "CATEGORY_RPC_UNAVAILABLE" },
      { status: 503 },
    );
  }
  if (message.includes("SUBCATEGORY_IN_USE:")) {
    return adminPrivateJson(
      { error: "该二级分类仍有商品使用。请先把这些商品移动到其他分类，或改为停用分类。", code: "SUBCATEGORY_IN_USE" },
      { status: 409 },
    );
  }
  if (message.includes("CATEGORY_IN_USE:")) {
    return adminPrivateJson(
      { error: "该一级分类仍有商品使用。请先把这些商品移动到其他分类，或改为停用分类。", code: "CATEGORY_IN_USE" },
      { status: 409 },
    );
  }
  if (message.includes("CATEGORY_SLUG_IMMUTABLE")) {
    return adminPrivateJson(
      { error: "已保存的一级分类 slug 不能修改；如需更换，请新增分类并移动商品。", code: "CATEGORY_SLUG_IMMUTABLE" },
      { status: 409 },
    );
  }
  if (message.includes("SUBCATEGORY_IDENTITY_IMMUTABLE")) {
    return adminPrivateJson(
      { error: "已保存的二级分类 slug 和所属一级分类不能修改。", code: "SUBCATEGORY_IDENTITY_IMMUTABLE" },
      { status: 409 },
    );
  }
  if (message.includes("ACTIVE_CATEGORY_REQUIRED")) {
    return adminPrivateJson(
      { error: "至少需要保留一个启用的一级分类。", code: "ACTIVE_CATEGORY_REQUIRED" },
      { status: 409 },
    );
  }
  if (code === "23505") {
    return adminPrivateJson(
      { error: "分类 slug 已存在，请使用不同的 slug。", code: "DUPLICATE_CATEGORY_SLUG" },
      { status: 409 },
    );
  }
  if (code === "23503") {
    return adminPrivateJson(
      { error: "二级分类对应的一级分类不存在，请刷新后重试。", code: "CATEGORY_PARENT_NOT_FOUND" },
      { status: 409 },
    );
  }
  return unavailable();
}

async function readCatalog() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { response: unavailable() };
  const [categories, subcategories] = await Promise.all([
    (supabase as any).from("product_categories").select(CATEGORY_SELECT).order("sort_order").order("slug"),
    (supabase as any).from("product_subcategories").select(SUBCATEGORY_SELECT).order("sort_order").order("slug"),
  ]);
  if (categories.error || subcategories.error) {
    const error = categories.error || subcategories.error;
    console.error("[categories] failed to load catalog", {
      code: String(error?.code || "CATEGORY_DATA_UNAVAILABLE"),
      message: String(error?.message || "Category catalog query failed"),
    });
    return { response: unavailable() };
  }
  return { categories: categories.data || [], subcategories: subcategories.data || [] };
}

export async function GET(request: NextRequest) {
  const rejected = await requireCategoryAccess(request, "products:read");
  if (rejected) return rejected;
  const catalog = await readCatalog();
  if (catalog.response) return catalog.response;
  return adminPrivateJson({ categories: catalog.categories, subcategories: catalog.subcategories });
}

export async function PUT(request: NextRequest) {
  const rejected = await requireCategoryAccess(request, "categories:write");
  if (rejected) return rejected;

  let mutation;
  try {
    mutation = parseCategoryCatalogMutation(await request.json());
  } catch (error) {
    if (error instanceof CategoryCatalogInputError) {
      return adminPrivateJson({ error: error.message, code: error.code }, { status: 400 });
    }
    return adminPrivateJson({ error: "分类请求格式无效。", code: "INVALID_CATEGORY_CATALOG" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const result = await (supabase as any).rpc("category_catalog_apply_rpc", {
    p_categories: mutation.categories,
    p_subcategories: mutation.subcategories,
    p_deleted_category_ids: mutation.deletedCategoryIds,
    p_deleted_subcategory_ids: mutation.deletedSubcategoryIds,
  });
  if (result.error) return databaseError(result.error);

  invalidateCategoriesCache();
  invalidateProductsCache();

  return adminPrivateJson({
    ok: true,
    result: result.data,
    categories: mutation.categories,
    subcategories: mutation.subcategories,
  });
}
