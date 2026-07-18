export type StorefrontLanguage = "el" | "en";

type QueryValue = string | number | boolean | null | undefined;

export function localizedStorefrontUrl(
  pathname: string,
  language: StorefrontLanguage,
  query: Record<string, QueryValue> = {},
  origin = "https://example.invalid",
) {
  const url = new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, `${origin.replace(/\/$/, "")}/`);
  url.search = "";
  for (const [key, value] of Object.entries(query)) {
    if (key === "lang" || value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (language === "en") url.searchParams.set("lang", "en");
  return url.toString();
}

export function buildLanguageAlternates(
  pathname: string,
  language: StorefrontLanguage,
  query: Record<string, QueryValue> = {},
  origin = "https://example.invalid",
) {
  const greek = localizedStorefrontUrl(pathname, "el", query, origin);
  const english = localizedStorefrontUrl(pathname, "en", query, origin);
  return {
    canonical: language === "en" ? english : greek,
    languages: {
      "el-GR": greek,
      en: english,
      "x-default": greek,
    },
  };
}
