import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { categoryLabels, getLanguage } from "@/lib/i18n";
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

export default async function DynamicCategoryPage({ params, searchParams }: CategoryRouteProps) {
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
