export const localizedLegalKeys = [
  "privacyRequestInstructions",
  "otherProviders",
  "essentialStorageDescription",
  "paymentTerms",
  "shippingPolicy",
  "returnPolicy",
  "refundPolicy",
  "withdrawalRight",
  "returnAddress",
  "returnShippingResponsibility",
  "nonReturnableItems",
] as const;

export type LocalizedLegalKey = (typeof localizedLegalKeys)[number];
export type LocalizedLegalSection = Record<LocalizedLegalKey, string>;
export type LocalizedLegalCopy = {
  el: LocalizedLegalSection;
  en: LocalizedLegalSection;
};

const requiredLabels: Array<[LocalizedLegalKey, string]> = [
  ["privacyRequestInstructions", "隐私请求说明"],
  ["essentialStorageDescription", "技术必需存储说明"],
  ["paymentTerms", "付款条款"],
  ["shippingPolicy", "配送政策"],
  ["returnPolicy", "退货政策"],
  ["refundPolicy", "退款政策"],
  ["withdrawalRight", "14 天撤回权说明"],
  ["returnAddress", "退货地址"],
  ["returnShippingResponsibility", "退货运费责任"],
  ["nonReturnableItems", "不支持退换商品说明"],
];

function emptySection(): LocalizedLegalSection {
  return {
    privacyRequestInstructions: "",
    otherProviders: "",
    essentialStorageDescription: "",
    paymentTerms: "",
    shippingPolicy: "",
    returnPolicy: "",
    refundPolicy: "",
    withdrawalRight: "",
    returnAddress: "",
    returnShippingResponsibility: "",
    nonReturnableItems: "",
  };
}

export function createEmptyLocalizedLegalCopy(): LocalizedLegalCopy {
  return { el: emptySection(), en: emptySection() };
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLocalizedLegalCopy(
  value: unknown,
  legacyEnglish: Partial<Record<LocalizedLegalKey, unknown>> = {},
) {
  const source = objectValue(value);
  const result = createEmptyLocalizedLegalCopy();
  for (const language of ["el", "en"] as const) {
    const languageSource = objectValue(source[language]);
    for (const key of localizedLegalKeys) {
      result[language][key] = stringValue(languageSource[key]);
    }
  }
  for (const key of localizedLegalKeys) {
    if (!result.en[key]) result.en[key] = stringValue(legacyEnglish[key]);
  }
  return result;
}

export function localizedLegalText(
  localized: LocalizedLegalCopy,
  key: LocalizedLegalKey,
  language: "el" | "en",
) {
  return localized[language][key].trim();
}

export function validateLocalizedLegalCopy(localized: LocalizedLegalCopy) {
  const errors: string[] = [];
  for (const [language, languageLabel] of [["el", "希腊语"], ["en", "英语"]] as const) {
    for (const [key, label] of requiredLabels) {
      if (!localized[language][key].trim()) errors.push(`${languageLabel}${label}不能为空`);
    }
  }
  return errors;
}
