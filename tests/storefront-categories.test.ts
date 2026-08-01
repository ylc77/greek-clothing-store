import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { buildStorefrontCategoryNavigation, splitDesktopCategoryNavigation } from "../lib/storefront-categories.ts";

function category(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    slug: `category-${index}`,
    name_cn: `中文分类 ${index}`,
    name_en: `Category ${index}`,
    name_gr: `Κατηγορία ${index}`,
    image_url: index === 1 ? "https://example.com/category.webp" : "",
    sort_order: index,
    is_active: true,
    ...overrides,
  };
}

test("storefront navigation renders every active database category beyond eight", () => {
  const cats = Object.fromEntries(
    Array.from({ length: 10 }, (_, offset) => {
      const item = category(offset + 1);
      return [item.slug, item];
    }),
  );
  const navigation = buildStorefrontCategoryNavigation({ cats, subs: {} }, "en");
  assert.equal(navigation.length, 10);
  assert.deepEqual(navigation.map((item) => item.slug), [
    "category-1", "category-2", "category-3", "category-4", "category-5",
    "category-6", "category-7", "category-8", "category-9", "category-10",
  ]);
  assert.equal(navigation[0].imageUrl, "https://example.com/category.webp");
  const desktop = splitDesktopCategoryNavigation(navigation);
  assert.equal(desktop.primary.length, 7);
  assert.equal(desktop.overflow.length, 3);
  assert.deepEqual(
    [...desktop.primary, ...desktop.overflow].map((item) => item.slug),
    navigation.map((item) => item.slug),
  );
});

test("storefront navigation uses database Greek and English labels and active subcategories", () => {
  const parent = category(1);
  const navigation = buildStorefrontCategoryNavigation({
    cats: { [parent.slug]: parent },
    subs: {
      [parent.slug]: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          category_id: parent.id,
          slug: "summer",
          name_cn: "夏季",
          name_en: "Summer",
          name_gr: "Καλοκαίρι",
          sort_order: 2,
          is_active: true,
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          category_id: parent.id,
          slug: "hidden",
          name_cn: "隐藏",
          name_en: "Hidden",
          name_gr: "Κρυφό",
          sort_order: 1,
          is_active: false,
        },
      ],
    },
  }, "el");
  assert.equal(navigation[0].label, "Κατηγορία 1");
  assert.deepEqual(navigation[0].subcategories, [{ slug: "summer", label: "Καλοκαίρι" }]);
});

test("storefront navigation never exposes Chinese names as a language fallback", () => {
  const parent = category(1, { name_en: "", name_gr: "" });
  const navigation = buildStorefrontCategoryNavigation({ cats: { [parent.slug]: parent }, subs: {} }, "en");
  assert.equal(navigation[0].label, "category-1");
  assert.doesNotMatch(navigation[0].label, /[一-鿿]/);
});

test("storefront navigation keeps the maintained eight-category fallback when database loading fails", () => {
  const fallback = Array.from({ length: 8 }, (_, index) => ({
    slug: ["men", "women", "shoes", "bags", "luggage", "hats", "jewelry", "other"][index],
    label: `Fallback ${index + 1}`,
    imageUrl: "",
    subcategories: index === 0 ? [{ slug: "tshirts", label: "T-shirts" }] : [],
  }));
  const navigation = buildStorefrontCategoryNavigation({ cats: {}, subs: {} }, "en", fallback);
  assert.equal(navigation.length, 8);
  assert.deepEqual(navigation.slice(0, 3).map((item) => item.slug), ["men", "women", "shoes"]);
  assert.equal(navigation[0].subcategories.length > 0, true);
});
