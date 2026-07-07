import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync, adminRequestIsOwnerAsync, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { cacheTags } from "@/lib/cache-tags";
import { getAdminLegalSettings, normalizeLegalSettings, validateLegalSettings } from "@/lib/legal-settings";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function actor(auth: Awaited<ReturnType<typeof getAdminAuthContextFromRequest>>) {
  return auth?.userId || auth?.email || auth?.displayName || auth?.role || "owner";
}

function refreshLegalPages() {
  revalidateTag(cacheTags.legal);
  for (const path of ["/privacy-policy", "/terms-of-service", "/cookie-policy", "/contact", "/refund-policy", "/cancellation-policy", "/return-policy", "/shipping-policy"]) {
    revalidatePath(path);
  }
}

export async function GET(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "settings:write"))) return unauthorized();
  return NextResponse.json({ ok: true, record: await getAdminLegalSettings() });
}

export async function PUT(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "settings:write"))) return unauthorized();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });

  const auth = await getAdminAuthContextFromRequest(request);
  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const settings = normalizeLegalSettings(payload.settings);
  const errors = validateLegalSettings(settings);

  const { error } = await (supabase as any).from("legal_settings").upsert({
    id: 1,
    draft: settings,
    is_complete: errors.length === 0,
    updated_by: actor(auth),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (error) {
    console.error("Failed to save legal settings", error);
    return NextResponse.json({ error: "保存失败，请确认 Legal Settings migration 已执行。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, errors, record: await getAdminLegalSettings() });
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestIsOwnerAsync(request))) return unauthorized();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });

  const auth = await getAdminAuthContextFromRequest(request);
  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const settings = normalizeLegalSettings(payload.settings);
  const errors = validateLegalSettings(settings);
  if (errors.length > 0) return NextResponse.json({ error: "法律信息未完成，不能发布。", errors }, { status: 400 });

  const { data: latest, error: latestError } = await (supabase as any)
    .from("legal_settings_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return NextResponse.json({ error: "无法读取法律版本记录。" }, { status: 500 });

  const versionNumber = Number(latest?.version_number || 0) + 1;
  const versionLabel = `v${versionNumber}`;
  const publishedAt = new Date().toISOString();
  const publishedBy = actor(auth);

  const { data: version, error: versionError } = await (supabase as any)
    .from("legal_settings_versions")
    .insert({ version_number: versionNumber, version_label: versionLabel, snapshot: settings, is_current: false, published_at: publishedAt, published_by: publishedBy })
    .select("id")
    .single();
  if (versionError || !version) {
    console.error("Failed to create legal settings version", versionError);
    return NextResponse.json({ error: "发布失败，无法生成新版本。请重试。" }, { status: 409 });
  }

  const { error: clearError } = await (supabase as any).from("legal_settings_versions").update({ is_current: false }).eq("is_current", true);
  if (clearError) return NextResponse.json({ error: "版本已创建，但无法切换当前版本。" }, { status: 500 });
  const { error: currentError } = await (supabase as any).from("legal_settings_versions").update({ is_current: true }).eq("id", version.id);
  if (currentError) return NextResponse.json({ error: "版本已创建，但无法设为当前版本。" }, { status: 500 });

  const { error: settingsError } = await (supabase as any).from("legal_settings").upsert({
    id: 1,
    draft: settings,
    is_complete: true,
    current_version_number: versionNumber,
    published_at: publishedAt,
    published_by: publishedBy,
    updated_by: publishedBy,
    updated_at: publishedAt,
  }, { onConflict: "id" });
  if (settingsError) return NextResponse.json({ error: "版本已发布，但草稿状态同步失败。" }, { status: 500 });

  refreshLegalPages();
  return NextResponse.json({ ok: true, version: versionLabel, record: await getAdminLegalSettings() });
}
