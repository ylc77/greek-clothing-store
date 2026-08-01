const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBCATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export const MAX_CATEGORY_COUNT = 100;
export const MAX_SUBCATEGORY_COUNT = 1_000;

export type CategoryCatalogCategory = {
  id: string;
  slug: string;
  name_cn: string;
  name_en: string;
  name_gr: string;
  image_url: string;
  sort_order: number;
  is_active: boolean;
};

export type CategoryCatalogSubcategory = {
  id: string;
  category_id: string;
  slug: string;
  name_cn: string;
  name_en: string;
  name_gr: string;
  sort_order: number;
  is_active: boolean;
};

export type CategoryCatalogMutation = {
  categories: CategoryCatalogCategory[];
  subcategories: CategoryCatalogSubcategory[];
  deletedCategoryIds: string[];
  deletedSubcategoryIds: string[];
};

export class CategoryCatalogInputError extends Error {
  readonly code = "INVALID_CATEGORY_CATALOG";

  constructor(message: string) {
    super(message);
    this.name = "CategoryCatalogInputError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CategoryCatalogInputError(`${label} 格式无效。`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, max: number) {
  if (!Array.isArray(value)) throw new CategoryCatalogInputError(`${label} 必须是数组。`);
  if (value.length > max) throw new CategoryCatalogInputError(`${label} 最多允许 ${max} 项。`);
  return value;
}

function text(value: unknown, label: string, maxLength: number, required = true) {
  if (typeof value !== "string") throw new CategoryCatalogInputError(`${label} 格式无效。`);
  const normalized = value.trim();
  if (required && !normalized) throw new CategoryCatalogInputError(`${label}不能为空。`);
  if (normalized.length > maxLength) throw new CategoryCatalogInputError(`${label}不能超过 ${maxLength} 个字符。`);
  return normalized;
}

function uuid(value: unknown, label: string) {
  const normalized = text(value, label, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new CategoryCatalogInputError(`${label} 必须是有效 UUID。`);
  return normalized;
}

function sortOrder(value: unknown, label: string) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < -100_000 || normalized > 100_000) {
    throw new CategoryCatalogInputError(`${label} 必须是有效整数。`);
  }
  return normalized;
}

function active(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new CategoryCatalogInputError(`${label} 必须是布尔值。`);
  return value;
}

function imageUrl(value: unknown) {
  const normalized = text(value ?? "", "分类图片 URL", 2_048, false);
  if (!normalized) return "";
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CategoryCatalogInputError("分类图片 URL 必须是有效的网址。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CategoryCatalogInputError("分类图片 URL 只允许 http 或 https。");
  }
  return normalized;
}

function uniqueIds(value: unknown, label: string, max: number) {
  const values = array(value ?? [], label, max).map((item, index) => uuid(item, `${label}第 ${index + 1} 项`));
  if (new Set(values).size !== values.length) throw new CategoryCatalogInputError(`${label}包含重复 ID。`);
  return values;
}

export function parseCategoryCatalogMutation(value: unknown): CategoryCatalogMutation {
  const input = record(value, "分类请求");
  const categories = array(input.categories, "一级分类", MAX_CATEGORY_COUNT).map((item, index) => {
    const category = record(item, `第 ${index + 1} 个一级分类`);
    const slug = text(category.slug, `第 ${index + 1} 个一级分类 slug`, 80).toLowerCase();
    if (!CATEGORY_SLUG_PATTERN.test(slug)) {
      throw new CategoryCatalogInputError(`一级分类 ${slug || index + 1} 的 slug 只允许小写英文、数字和单个横线。`);
    }
    return {
      id: uuid(category.id, `一级分类 ${slug} 的 ID`),
      slug,
      name_cn: text(category.name_cn, `一级分类 ${slug} 的中文名称`, 120),
      name_en: text(category.name_en, `一级分类 ${slug} 的英文名称`, 120),
      name_gr: text(category.name_gr, `一级分类 ${slug} 的希腊语名称`, 120),
      image_url: imageUrl(category.image_url),
      sort_order: sortOrder(category.sort_order, `一级分类 ${slug} 的排序`),
      is_active: active(category.is_active, `一级分类 ${slug} 的启用状态`),
    };
  });

  const categoryIds = new Set(categories.map((category) => category.id));
  const categorySlugs = categories.map((category) => category.slug);
  if (categoryIds.size !== categories.length) throw new CategoryCatalogInputError("一级分类包含重复 ID。");
  if (new Set(categorySlugs).size !== categorySlugs.length) throw new CategoryCatalogInputError("一级分类 slug 不能重复。");

  const subcategories = array(input.subcategories, "二级分类", MAX_SUBCATEGORY_COUNT).map((item, index) => {
    const subcategory = record(item, `第 ${index + 1} 个二级分类`);
    const slug = text(subcategory.slug, `第 ${index + 1} 个二级分类 slug`, 80).toLowerCase();
    if (!SUBCATEGORY_SLUG_PATTERN.test(slug)) {
      throw new CategoryCatalogInputError(`二级分类 ${slug || index + 1} 的 slug 只允许小写英文、数字、横线和下划线。`);
    }
    const categoryId = uuid(subcategory.category_id, `二级分类 ${slug} 的一级分类 ID`);
    if (!categoryIds.has(categoryId)) {
      throw new CategoryCatalogInputError(`二级分类 ${slug} 没有对应的一级分类。`);
    }
    return {
      id: uuid(subcategory.id, `二级分类 ${slug} 的 ID`),
      category_id: categoryId,
      slug,
      name_cn: text(subcategory.name_cn, `二级分类 ${slug} 的中文名称`, 120),
      name_en: text(subcategory.name_en, `二级分类 ${slug} 的英文名称`, 120),
      name_gr: text(subcategory.name_gr, `二级分类 ${slug} 的希腊语名称`, 120),
      sort_order: sortOrder(subcategory.sort_order, `二级分类 ${slug} 的排序`),
      is_active: active(subcategory.is_active, `二级分类 ${slug} 的启用状态`),
    };
  });

  const subcategoryIds = new Set(subcategories.map((subcategory) => subcategory.id));
  if (subcategoryIds.size !== subcategories.length) throw new CategoryCatalogInputError("二级分类包含重复 ID。");
  const subcategoryKeys = subcategories.map((subcategory) => `${subcategory.category_id}:${subcategory.slug}`);
  if (new Set(subcategoryKeys).size !== subcategoryKeys.length) {
    throw new CategoryCatalogInputError("同一个一级分类下的二级分类 slug 不能重复。");
  }

  const deletedCategoryIds = uniqueIds(input.deletedCategoryIds, "待删除一级分类", MAX_CATEGORY_COUNT);
  const deletedSubcategoryIds = uniqueIds(input.deletedSubcategoryIds, "待删除二级分类", MAX_SUBCATEGORY_COUNT);
  if (deletedCategoryIds.some((id) => categoryIds.has(id))) {
    throw new CategoryCatalogInputError("同一个一级分类不能同时保存和删除。请刷新后重试。");
  }
  if (deletedSubcategoryIds.some((id) => subcategoryIds.has(id))) {
    throw new CategoryCatalogInputError("同一个二级分类不能同时保存和删除。请刷新后重试。");
  }

  return { categories, subcategories, deletedCategoryIds, deletedSubcategoryIds };
}
