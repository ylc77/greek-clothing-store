import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { categoryLabels, getLanguage, subcategoryLabels } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { buildLanguageAlternates } from "@/lib/storefront-seo";
import { isProductCategory } from "@/lib/types";

type CategoryRouteProps = {
  params: Promise<{
    category: string;
  }>;
  searchParams: Promise<{
    lang?: string;
    subcategory?: string;
    page?: string;
  }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CategoryRouteProps): Promise<Metadata> {
  const [{ category }, resolvedSearchParams, settings] = await Promise.all([
    params,
    searchParams,
    getBusinessSettings(),
  ]);
  const language = getLanguage(resolvedSearchParams.lang);

  if (!isProductCategory(category)) {
    return { title: settings.business_name };
  }

  const selectedSubcategory = resolvedSearchParams.subcategory;
  const page = Math.max(1, Math.trunc(Number(resolvedSearchParams.page) || 1));
  const categoryLabel = categoryLabels[category][language];
  const subcategoryLabel =
    selectedSubcategory && subcategoryLabels[selectedSubcategory]
      ? subcategoryLabels[selectedSubcategory][language]
      : "";
  const pageLabel = subcategoryLabel ? `${subcategoryLabel} · ${categoryLabel}` : categoryLabel;
  const title = `${pageLabel} | ${settings.business_name}`;
  return {
    title,
    description: language === "en"
      ? `Browse ${pageLabel.toLowerCase()} at ${settings.business_name}.`
      : `Δείτε ${pageLabel.toLowerCase()} στο ${settings.business_name}.`,
    alternates: buildLanguageAlternates(
      `/${category}`,
      language,
      { subcategory: selectedSubcategory, page: page > 1 ? String(page) : undefined },
      siteUrl(),
    ),
    openGraph: {
      title,
      siteName: settings.business_name,
      url: buildLanguageAlternates(`/${category}`, language, { subcategory: selectedSubcategory, page: page > 1 ? String(page) : undefined }, siteUrl()).canonical,
    },
  };
}

export default async function DynamicCategoryPage({
  params,
  searchParams,
}: CategoryRouteProps) {
  const [{ category }, resolvedSearchParams, settings] = await Promise.all([
    params,
    searchParams,
    getBusinessSettings(),
  ]);
  const language = getLanguage(resolvedSearchParams.lang);

  if (!isProductCategory(category)) {
    notFound();
  }

  return (
    <CategoryPage
      category={category}
      language={language}
      selectedSubcategory={resolvedSearchParams.subcategory}
      page={Math.max(1, Math.trunc(Number(resolvedSearchParams.page) || 1))}
      title={categoryLabels[category][language]}
      settings={settings}
    />
  );
}
