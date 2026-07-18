import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { cacheTags } from "@/lib/cache-tags";
import { developerRequestIsAuthorized } from "@/lib/developer-auth";
import {
  getFeatureFlagsForPlan,
  getFeatureSettingsUncached,
  isFeaturePlan,
  normalizeFeatureFlags,
  type FeaturePlan,
} from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { adminAuthorizationFailure, adminPrivateJson } from "@/lib/admin-response";

export const dynamic = "force-dynamic";

function unauthorized() {
  return adminPrivateJson({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "products:read");
  if (!authorization.allowed && !(await developerRequestIsAuthorized(request))) {
    return adminAuthorizationFailure(authorization);
  }

  return adminPrivateJson({ ok: true, settings: await getFeatureSettingsUncached() });
}

export async function PUT(request: NextRequest) {
  if (!(await developerRequestIsAuthorized(request))) return unauthorized();

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return adminPrivateJson({ error: "Feature settings are unavailable.", code: "FEATURE_SETTINGS_UNAVAILABLE" }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return adminPrivateJson({ error: "Invalid JSON body.", code: "INVALID_ARGUMENT" }, { status: 400 });
  }

  if (!isFeaturePlan(payload.plan)) {
    return adminPrivateJson(
      { error: "plan must be basic, standard, advanced, or custom.", code: "INVALID_ARGUMENT" },
      { status: 400 },
    );
  }

  const plan: FeaturePlan = payload.plan;
  const current = await getFeatureSettingsUncached();
  const features = plan === "custom"
    ? normalizeFeatureFlags(payload.features, current.features)
    : getFeatureFlagsForPlan(plan);
  const { error } = await (supabase as any)
    .from("feature_settings")
    .upsert({
      id: 1,
      plan,
      features,
      updated_by: "developer",
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (error) {
    console.error("Failed to save feature settings", error);
    return adminPrivateJson(
      { error: "Feature settings are unavailable.", code: "FEATURE_SETTINGS_UNAVAILABLE" },
      { status: 503 },
    );
  }

  revalidateTag(cacheTags.features);
  return adminPrivateJson({ ok: true, settings: await getFeatureSettingsUncached() });
}
