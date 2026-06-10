import { notFound } from "next/navigation";
import { CategoryPage } from "@/components/category-page";
import { getCategoryLabel, isProductCategory } from "@/lib/types";

type CategoryRouteProps = {
  params: Promise<{
    category: string;
  }>;
};

export default async function DynamicCategoryPage({ params }: CategoryRouteProps) {
  const { category } = await params;

  if (!isProductCategory(category)) {
    notFound();
  }

  return <CategoryPage category={category} title={getCategoryLabel(category)} />;
}
