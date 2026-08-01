export type StorefrontCategoryLanguage = "el" | "en";

export type StorefrontCategorySource = {
  id: string;
  slug: string;
  name_cn: string;
  name_en: string;
  name_gr: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export type StorefrontSubcategorySource = {
  id: string;
  category_id: string;
  slug: string;
  name_cn: string;
  name_en: string;
  name_gr: string;
  sort_order: number;
  is_active: boolean;
};

export type StorefrontCategoryData = {
  cats: Record<string, StorefrontCategorySource>;
  subs: Record<string, StorefrontSubcategorySource[]>;
};

export type StorefrontCategoryNavigationItem = {
  slug: string;
  label: string;
  imageUrl: string;
  subcategories: Array<{
    slug: string;
    label: string;
  }>;
};

function localizedName(
  value: { slug: string; name_en?: string; name_gr?: string } | undefined,
  language: StorefrontCategoryLanguage,
  fallback: string,
) {
  if (!value) return fallback;
  const localized = language === "en" ? value.name_en : value.name_gr;
  return localized?.trim() || value.name_en?.trim() || value.name_gr?.trim() || fallback;
}

export function buildStorefrontCategoryNavigation(
  data: StorefrontCategoryData,
  language: StorefrontCategoryLanguage,
  fallbackNavigation: StorefrontCategoryNavigationItem[] = [],
): StorefrontCategoryNavigationItem[] {
  const databaseCategories = Object.values(data.cats)
    .filter((category) => category.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.slug.localeCompare(right.slug));

  if (databaseCategories.length === 0) {
    return fallbackNavigation;
  }

  return databaseCategories.map((category) => ({
    slug: category.slug,
    label: localizedName(category, language, category.slug),
    imageUrl: category.image_url?.trim() || "",
    subcategories: (data.subs[category.slug] || [])
      .filter((subcategory) => subcategory.is_active)
      .sort((left, right) => left.sort_order - right.sort_order || left.slug.localeCompare(right.slug))
      .map((subcategory) => ({
        slug: subcategory.slug,
        label: localizedName(
          subcategory,
          language,
          subcategory.slug,
        ),
      })),
  }));
}

export function splitDesktopCategoryNavigation(
  navigation: StorefrontCategoryNavigationItem[],
) {
  if (navigation.length <= 8) {
    return { primary: navigation, overflow: [] as StorefrontCategoryNavigationItem[] };
  }
  return {
    primary: navigation.slice(0, 7),
    overflow: navigation.slice(7),
  };
}
