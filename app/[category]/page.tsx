import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { categoryLabels, getLanguage, subcategoryLabels } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { isProductCategory } from "@/lib/types";

type CategoryRouteProps = {
  params: Promise<{
    category: string;
  }>;
  searchParams: Promise<{
    lang?: string;
    subcategory?: string;
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
  const categoryLabel = categoryLabels[category][language];
  const subcategoryLabel =
    selectedSubcategory && subcategoryLabels[selectedSubcategory]
      ? subcategoryLabels[selectedSubcategory][language]
      : "";
  const pageLabel = subcategoryLabel ? `${subcategoryLabel} · ${categoryLabel}` : categoryLabel;
  const title = `${pageLabel} | ${settings.business_name}`;
  return {
    title,
    description: `Browse ${pageLabel.toLowerCase()} at ${settings.business_name}.`,
    alternates: { canonical: `${siteUrl()}/${category}${selectedSubcategory ? `?subcategory=${encodeURIComponent(selectedSubcategory)}` : ""}` },
    openGraph: { title, siteName: settings.business_name },
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
      title={categoryLabels[category][language]}
      settings={settings}
    />
  );
}
