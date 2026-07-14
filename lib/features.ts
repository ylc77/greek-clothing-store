/**
 * Server-side customer plan and feature configuration.
 * Never import this module from a Client Component.
 */

import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { cacheTags } from "@/lib/cache-tags";
import {
  featurePlanPresets,
  getFeatureFlagsForPlan,
  isFeaturePlan,
  normalizeFeatureFlags,
  type FeatureFlags,
  type FeatureKey,
  type FeaturePlan,
} from "@/lib/feature-catalog";
import { getSupabaseAdminClient } from "@/lib/supabase";

export {
  featureKeys,
  featurePlanPresets,
  getFeatureFlagsForPlan,
  isFeaturePlan,
  normalizeFeatureFlags,
  type FeatureFlags,
  type FeatureKey,
  type FeaturePlan,
} from "@/lib/feature-catalog";

export type FeatureSettings = {
  id: number;
  plan: FeaturePlan;
  features: FeatureFlags;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  configured: boolean;
};

const fallbackSettings: FeatureSettings = {
  id: 1,
  plan: "basic",
  features: { ...featurePlanPresets.basic },
  updated_by: null,
  created_at: null,
  updated_at: null,
  configured: false,
};

async function loadFeatureSettings(): Promise<FeatureSettings> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return fallbackSettings;

  const { data, error } = await (supabase as any)
    .from("feature_settings")
    .select("id, plan, features, updated_by, created_at, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return fallbackSettings;

  const plan: FeaturePlan = isFeaturePlan(data.plan) ? data.plan : "basic";
  const presetFallback = plan === "custom" ? featurePlanPresets.basic : featurePlanPresets[plan];

  return {
    id: 1,
    plan,
    features: normalizeFeatureFlags(data.features, presetFallback),
    updated_by: typeof data.updated_by === "string" ? data.updated_by : null,
    created_at: typeof data.created_at === "string" ? data.created_at : null,
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
    configured: true,
  };
}

const getFeatureSettingsCached = unstable_cache(
  loadFeatureSettings,
  ["feature-settings"],
  { revalidate: 300, tags: [cacheTags.features] },
);

export async function getFeatureSettings(): Promise<FeatureSettings> {
  return getFeatureSettingsCached();
}

export async function getFeatureSettingsUncached(): Promise<FeatureSettings> {
  return loadFeatureSettings();
}

export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  const settings = await getFeatureSettings();
  return settings.features[key];
}

export async function isFeatureEnabledUncached(key: FeatureKey): Promise<boolean> {
  const settings = await getFeatureSettingsUncached();
  return settings.features[key];
}

export function featureDisabledResponse(key: FeatureKey) {
  return NextResponse.json(
    { error: "当前客户版本未启用该功能。", code: "FEATURE_DISABLED", feature: key },
    { status: 403 },
  );
}
