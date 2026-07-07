/**
 * Server-side customer plan and feature configuration.
 * Never import this module from a Client Component.
 */

import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { cacheTags } from "@/lib/cache-tags";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const featureKeys = [
  "storefront",
  "product_management",
  "inventory",
  "pos_checkout",
  "pos_orders",
  "pos_void",
  "pos_reports",
  "receipt_printing",
  "barcode_labels",
  "csv_import",
  "skroutz_feed",
  "staff_accounts",
  "ai_tools",
  "backup_tools",
] as const;

export type FeatureKey = (typeof featureKeys)[number];
export type FeaturePlan = "basic" | "standard" | "advanced" | "custom";
export type FeatureFlags = Record<FeatureKey, boolean>;

export type FeatureSettings = {
  id: number;
  plan: FeaturePlan;
  features: FeatureFlags;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  configured: boolean;
};

const basicFeatures: FeatureFlags = {
  storefront: true,
  product_management: true,
  inventory: false,
  pos_checkout: false,
  pos_orders: false,
  pos_void: false,
  pos_reports: false,
  receipt_printing: false,
  barcode_labels: false,
  csv_import: false,
  skroutz_feed: false,
  staff_accounts: false,
  ai_tools: false,
  backup_tools: false,
};

const standardFeatures: FeatureFlags = {
  storefront: true,
  product_management: true,
  inventory: true,
  pos_checkout: true,
  pos_orders: true,
  pos_void: false,
  pos_reports: true,
  receipt_printing: true,
  barcode_labels: true,
  csv_import: true,
  skroutz_feed: true,
  staff_accounts: true,
  ai_tools: false,
  backup_tools: false,
};

const advancedFeatures: FeatureFlags = Object.fromEntries(
  featureKeys.map((key) => [key, true]),
) as FeatureFlags;

export const featurePlanPresets: Record<Exclude<FeaturePlan, "custom">, FeatureFlags> = {
  basic: basicFeatures,
  standard: standardFeatures,
  advanced: advancedFeatures,
};

export function isFeaturePlan(value: unknown): value is FeaturePlan {
  return value === "basic" || value === "standard" || value === "advanced" || value === "custom";
}

export function normalizeFeatureFlags(value: unknown, fallback: FeatureFlags = advancedFeatures): FeatureFlags {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return Object.fromEntries(
    featureKeys.map((key) => [key, typeof source[key] === "boolean" ? source[key] : fallback[key]]),
  ) as FeatureFlags;
}

export function getFeatureFlagsForPlan(plan: Exclude<FeaturePlan, "custom">): FeatureFlags {
  return { ...featurePlanPresets[plan] };
}

const fallbackSettings: FeatureSettings = {
  id: 1,
  plan: "advanced",
  features: { ...advancedFeatures },
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

  const plan: FeaturePlan = isFeaturePlan(data.plan) ? data.plan : "advanced";
  const presetFallback = plan === "custom" ? advancedFeatures : featurePlanPresets[plan];

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

export function featureDisabledResponse(key: FeatureKey) {
  return NextResponse.json(
    { error: "当前客户版本未启用该功能。", code: "FEATURE_DISABLED", feature: key },
    { status: 403 },
  );
}
