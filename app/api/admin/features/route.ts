import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { adminRequestIsOwnerAsync, getAdminAuthContextFromRequest } from "@/lib/admin-auth";
import { cacheTags } from "@/lib/cache-tags";
import {
  getFeatureFlagsForPlan,
  getFeatureSettingsUncached,
  isFeaturePlan,
  normalizeFeatureFlags,
  type FeaturePlan,
} from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!(await getAdminAuthContextFromRequest(request))) return unauthorized();

  return NextResponse.json({ ok: true, settings: await getFeatureSettingsUncached() });
}

export async function PUT(request: NextRequest) {
  if (!(await adminRequestIsOwnerAsync(request))) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isFeaturePlan(payload.plan)) {
    return NextResponse.json(
      { error: "plan must be basic, standard, advanced, or custom." },
      { status: 400 },
    );
  }

  const plan: FeaturePlan = payload.plan;
  const current = await getFeatureSettingsUncached();
  const features = plan === "custom"
    ? normalizeFeatureFlags(payload.features, current.features)
    : getFeatureFlagsForPlan(plan);
  const auth = await getAdminAuthContextFromRequest(request);
  const updatedBy = auth?.email || auth?.displayName || auth?.role || "owner";

  const { error } = await (supabase as any)
    .from("feature_settings")
    .upsert({
      id: 1,
      plan,
      features,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    console.error("Failed to save feature settings", error);
    return NextResponse.json(
      { error: "Failed to save feature settings. Confirm the feature_settings migration has been applied." },
      { status: 500 },
    );
  }

  revalidateTag(cacheTags.features);
  return NextResponse.json({ ok: true, settings: await getFeatureSettingsUncached() });
}
