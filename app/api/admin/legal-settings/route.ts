import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { cacheTags } from "@/lib/cache-tags";
import { developerRequestIsAuthorized } from "@/lib/developer-auth";
import { getAdminLegalSettings, normalizeLegalSettings, validateLegalSettings } from "@/lib/legal-settings";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function refreshLegalPages() {
  revalidateTag(cacheTags.legal);
  for (const path of ["/privacy-policy", "/terms-of-service", "/cookie-policy", "/contact", "/refund-policy", "/return-policy", "/shipping-policy"]) {
    revalidatePath(path);
  }
}

export async function GET(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) return unauthorized();
  return NextResponse.json({ ok: true, record: await getAdminLegalSettings() });
}

export async function PUT(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) return unauthorized();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });

  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const settings = normalizeLegalSettings(payload.settings);
  const errors = validateLegalSettings(settings);

  const { error } = await (supabase as any).from("legal_settings").upsert({
    id: 1,
    draft: settings,
    is_complete: errors.length === 0,
    updated_by: "developer",
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  if (error) {
    console.error("Failed to save legal settings", error);
    return NextResponse.json({ error: "保存失败，请确认 Legal Settings migration 已执行。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, errors, record: await getAdminLegalSettings() });
}

export async function POST(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) return unauthorized();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });

  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const settings = normalizeLegalSettings(payload.settings);
  const errors = validateLegalSettings(settings);
  if (errors.length > 0) return NextResponse.json({ error: "法律信息未完成，不能发布。", errors }, { status: 400 });

  const { data: published, error: publishError } = await (supabase as any).rpc(
    "legal_settings_publish_rpc",
    { p_settings: settings, p_published_by: "developer" },
  );
  const versionLabel = typeof published?.version_label === "string" ? published.version_label : "";
  if (publishError || !versionLabel) {
    console.error("Transactional legal settings publish unavailable", {
      code: publishError?.code,
      message: publishError?.message,
    });
    return NextResponse.json(
      { error: "法律配置事务发布不可用，请确认最新 migration 已执行后重试。", code: "LEGAL_PUBLISH_UNAVAILABLE" },
      { status: 503 },
    );
  }

  refreshLegalPages();
  return NextResponse.json({ ok: true, version: versionLabel, record: await getAdminLegalSettings() });
}
