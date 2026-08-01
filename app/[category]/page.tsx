import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { loadCategories } from "@/lib/categories-data";
import { getLanguage } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { getStorefrontCategoryNavigation } from "@/lib/storefront-category-navigation";
import { buildLanguageAlternates } from "@/lib/storefront-seo";

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
  const [{ category }, resolvedSearchParams, settings, categoryData] = await Promise.all([
    params,
    searchParams,
    getBusinessSettings(),
    loadCategories(),
  ]);
  const language = getLanguage(resolvedSearchParams.lang);
  const categoryNavigation = getStorefrontCategoryNavigation(categoryData, language);
  const categoryEntry = categoryNavigation.find((item) => item.slug === category);
  if (!categoryEntry) {
    return { title: settings.business_name };
  }

  const selectedSubcategory = resolvedSearchParams.subcategory;
  const page = Math.max(1, Math.trunc(Number(resolvedSearchParams.page) || 1));
  const categoryLabel = categoryEntry.label;
  const subcategoryLabel = categoryEntry.subcategories.find((item) => item.slug === selectedSubcategory)?.label || "";
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
  const [{ category }, resolvedSearchParams, settings, categoryData] = await Promise.all([
    params,
    searchParams,
    getBusinessSettings(),
    loadCategories(),
  ]);
  const language = getLanguage(resolvedSearchParams.lang);
  const categoryEntry = getStorefrontCategoryNavigation(categoryData, language)
    .find((item) => item.slug === category);
  if (!categoryEntry) {
    notFound();
  }

  return (
    <CategoryPage
      category={category}
      language={language}
      selectedSubcategory={resolvedSearchParams.subcategory}
      page={Math.max(1, Math.trunc(Number(resolvedSearchParams.page) || 1))}
      title={categoryEntry.label}
      subcategories={categoryEntry.subcategories}
      settings={settings}
    />
  );
}
