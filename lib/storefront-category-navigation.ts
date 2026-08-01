import { categoryLabels, subcategoryLabels, type Language } from "@/lib/i18n";
import {
  buildStorefrontCategoryNavigation,
  type StorefrontCategoryData,
  type StorefrontCategoryNavigationItem,
} from "@/lib/storefront-categories";
import { categories as fallbackCategories, subcategoryList } from "@/lib/types";

function fallbackCategoryNavigation(language: Language): StorefrontCategoryNavigationItem[] {
  return fallbackCategories.map(({ slug }) => ({
    slug,
    label: categoryLabels[slug]?.[language] || slug,
    imageUrl: "",
    subcategories: (subcategoryList[slug] || []).map((subcategory) => ({
      slug: subcategory,
      label: subcategoryLabels[subcategory]?.[language] || subcategory,
    })),
  }));
}

export function getStorefrontCategoryNavigation(
  data: StorefrontCategoryData,
  language: Language,
) {
  return buildStorefrontCategoryNavigation(data, language, fallbackCategoryNavigation(language));
}
