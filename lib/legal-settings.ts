import { getSupabaseAdminClient, getSupabaseClient } from "@/lib/supabase";

export const legalProviderKeys = [
  "supabase", "vercel", "stripe", "viva", "cash", "pos", "posthog", "sentry", "openai", "deepseek",
] as const;

export type LegalProviderKey = (typeof legalProviderKeys)[number];
export type ProjectType = "retail" | "restaurant";

export type LegalConfirmations = {
  businessIdentity: boolean;
  paymentCopy: boolean;
  fulfilmentCopy: boolean;
  providers: boolean;
  disclaimer: boolean;
};

export type LegalSettingsData = {
  projectType: ProjectType;
  businessName: string;
  legalName: string;
  businessAddress: string;
  vatNumber: string;
  gemiNumber: string;
  country: string;
  phone: string;
  contactEmail: string;
  dataControllerName: string;
  dataControllerAddress: string;
  privacyRequestEmail: string;
  privacyRequestInstructions: string;
  enabledProviders: LegalProviderKey[];
  otherProviders: string;
  essentialStorageDescription: string;
  analyticsEnabled: boolean;
  errorMonitoringEnabled: boolean;
  advertisingEnabled: boolean;
  cookieLastUpdated: string;
  shippingPolicy: string;
  returnPolicy: string;
  refundPolicy: string;
  withdrawalRight: string;
  returnAddress: string;
  returnShippingResponsibility: string;
  nonReturnableItems: string;
  cancellationPolicy: string;
  allergenDisclaimer: string;
  receiptDisclaimer: string;
  paymentTerms: string;
  legalLastUpdated: string;
  confirmations: LegalConfirmations;
};

export type LegalSettingsRecord = {
  settings: LegalSettingsData;
  configured: boolean;
  complete: boolean;
  currentVersion: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  updatedAt: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export function createEmptyLegalSettings(): LegalSettingsData {
  return {
    projectType: "retail",
    businessName: "",
    legalName: "",
    businessAddress: "",
    vatNumber: "",
    gemiNumber: "",
    country: "Greece",
    phone: "",
    contactEmail: "",
    dataControllerName: "",
    dataControllerAddress: "",
    privacyRequestEmail: "",
    privacyRequestInstructions: "",
    enabledProviders: ["supabase", "vercel"],
    otherProviders: "",
    essentialStorageDescription: "Language, security, administrator login and cookie preference storage required for the website to operate.",
    analyticsEnabled: false,
    errorMonitoringEnabled: false,
    advertisingEnabled: false,
    cookieLastUpdated: today(),
    shippingPolicy: "",
    returnPolicy: "",
    refundPolicy: "",
    withdrawalRight: "",
    returnAddress: "",
    returnShippingResponsibility: "",
    nonReturnableItems: "",
    cancellationPolicy: "",
    allergenDisclaimer: "",
    receiptDisclaimer: "",
    paymentTerms: "",
    legalLastUpdated: today(),
    confirmations: {
      businessIdentity: false,
      paymentCopy: false,
      fulfilmentCopy: false,
      providers: false,
      disclaimer: false,
    },
  };
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeLegalSettings(value: unknown): LegalSettingsData {
  const defaults = createEmptyLegalSettings();
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const confirmations = source.confirmations && typeof source.confirmations === "object"
    ? source.confirmations as Record<string, unknown>
    : {};
  const providers = Array.isArray(source.enabledProviders)
    ? source.enabledProviders.filter((key): key is LegalProviderKey => legalProviderKeys.includes(key as LegalProviderKey))
    : defaults.enabledProviders;

  return {
    ...defaults,
    projectType: "retail",
    businessName: stringValue(source.businessName),
    legalName: stringValue(source.legalName),
    businessAddress: stringValue(source.businessAddress),
    vatNumber: stringValue(source.vatNumber),
    gemiNumber: stringValue(source.gemiNumber),
    country: stringValue(source.country, defaults.country),
    phone: stringValue(source.phone),
    contactEmail: stringValue(source.contactEmail),
    dataControllerName: stringValue(source.dataControllerName),
    dataControllerAddress: stringValue(source.dataControllerAddress),
    privacyRequestEmail: stringValue(source.privacyRequestEmail),
    privacyRequestInstructions: stringValue(source.privacyRequestInstructions),
    enabledProviders: Array.from(new Set(providers)),
    otherProviders: stringValue(source.otherProviders),
    essentialStorageDescription: stringValue(source.essentialStorageDescription, defaults.essentialStorageDescription),
    analyticsEnabled: source.analyticsEnabled === true,
    errorMonitoringEnabled: source.errorMonitoringEnabled === true,
    advertisingEnabled: source.advertisingEnabled === true,
    cookieLastUpdated: stringValue(source.cookieLastUpdated, defaults.cookieLastUpdated),
    shippingPolicy: stringValue(source.shippingPolicy),
    returnPolicy: stringValue(source.returnPolicy),
    refundPolicy: stringValue(source.refundPolicy),
    withdrawalRight: stringValue(source.withdrawalRight),
    returnAddress: stringValue(source.returnAddress),
    returnShippingResponsibility: stringValue(source.returnShippingResponsibility),
    nonReturnableItems: stringValue(source.nonReturnableItems),
    cancellationPolicy: stringValue(source.cancellationPolicy),
    allergenDisclaimer: stringValue(source.allergenDisclaimer),
    receiptDisclaimer: stringValue(source.receiptDisclaimer),
    paymentTerms: stringValue(source.paymentTerms),
    legalLastUpdated: stringValue(source.legalLastUpdated, defaults.legalLastUpdated),
    confirmations: {
      businessIdentity: confirmations.businessIdentity === true,
      paymentCopy: confirmations.paymentCopy === true,
      fulfilmentCopy: confirmations.fulfilmentCopy === true,
      providers: confirmations.providers === true,
      disclaimer: confirmations.disclaimer === true,
    },
  };
}

export function validateLegalSettings(settings: LegalSettingsData) {
  const fields: Array<[keyof LegalSettingsData, string]> = [
    ["businessName", "商家展示名称"],
    ["legalName", "法律主体名称"],
    ["businessAddress", "营业地址"],
    ["vatNumber", "VAT / AFM"],
    ["phone", "联系电话"],
    ["contactEmail", "联系邮箱"],
    ["legalLastUpdated", "最后更新时间"],
  ];
  const errors = fields.filter(([key]) => !String(settings[key] || "").trim()).map(([, label]) => `${label}不能为空`);
  if (settings.contactEmail && !/^\S+@\S+\.\S+$/.test(settings.contactEmail)) errors.push("联系邮箱格式不正确");
  if (settings.privacyRequestEmail && !/^\S+@\S+\.\S+$/.test(settings.privacyRequestEmail)) errors.push("隐私请求邮箱格式不正确");
  const confirmationValues = Object.values(settings.confirmations);
  if (!confirmationValues.every(Boolean)) errors.push("客户最终确认未全部完成");
  return errors;
}

export async function getAdminLegalSettings(): Promise<LegalSettingsRecord> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { settings: createEmptyLegalSettings(), configured: false, complete: false, currentVersion: null, publishedAt: null, publishedBy: null, updatedAt: null };
  const { data, error } = await (supabase as any).from("legal_settings").select("draft, is_complete, current_version_number, published_at, published_by, updated_at").eq("id", 1).maybeSingle();
  if (error || !data) return { settings: createEmptyLegalSettings(), configured: false, complete: false, currentVersion: null, publishedAt: null, publishedBy: null, updatedAt: null };
  return {
    settings: normalizeLegalSettings(data.draft),
    configured: true,
    complete: data.is_complete === true,
    currentVersion: data.current_version_number ? `v${data.current_version_number}` : null,
    publishedAt: data.published_at || null,
    publishedBy: data.published_by || null,
    updatedAt: data.updated_at || null,
  };
}

export async function getPublishedLegalSettings(): Promise<LegalSettingsRecord> {
  const supabase = getSupabaseClient();
  if (!supabase) return { settings: createEmptyLegalSettings(), configured: false, complete: false, currentVersion: null, publishedAt: null, publishedBy: null, updatedAt: null };
  const { data, error } = await (supabase as any).from("legal_settings_versions").select("version_label, snapshot, published_at, published_by").eq("is_current", true).maybeSingle();
  if (error || !data) return { settings: createEmptyLegalSettings(), configured: false, complete: false, currentVersion: null, publishedAt: null, publishedBy: null, updatedAt: null };
  return {
    settings: normalizeLegalSettings(data.snapshot),
    configured: true,
    complete: true,
    currentVersion: data.version_label || null,
    publishedAt: data.published_at || null,
    publishedBy: data.published_by || null,
    updatedAt: data.published_at || null,
  };
}
