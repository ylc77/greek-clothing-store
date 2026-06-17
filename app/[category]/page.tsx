import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { categoryLabels, getLanguage } from "@/lib/i18n";
import { siteName, siteUrl } from "@/lib/site";
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
  const { category } = await params;
  const language = getLanguage((await searchParams).lang);

  if (!isProductCategory(category)) {
    return { title: siteName };
  }

  const title = `${categoryLabels[category][language]} | ${siteName}`;
  return {
    title,
    description: `Browse ${categoryLabels[category][language].toLowerCase()} at ${siteName}. Clothing, shoes, bags and accessories with Mediterranean style.`,
    alternates: { canonical: `${siteUrl()}/${category}` },
    openGraph: { title, siteName },
  };
}

export default async function DynamicCategoryPage({
  params,
  searchParams,
}: CategoryRouteProps) {
  const { category } = await params;
  const resolvedSearchParams = await searchParams;
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
    />
  );
}
