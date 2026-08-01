import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { CategoryCatalogInputError, parseCategoryCatalogMutation } from "../lib/category-catalog.ts";

const categoryId = "11111111-1111-4111-8111-111111111111";
const secondCategoryId = "22222222-2222-4222-8222-222222222222";
const subcategoryId = "33333333-3333-4333-8333-333333333333";

function validMutation() {
  return {
    categories: [{
      id: categoryId,
      slug: " women ",
      name_cn: " 女装 ",
      name_en: " Women ",
      name_gr: " Γυναικεία ",
      image_url: "https://example.com/category.webp",
      sort_order: 1,
      is_active: true,
      _is_new: true,
    }],
    subcategories: [{
      id: subcategoryId,
      category_id: categoryId,
      slug: " summer-dresses ",
      name_cn: " 夏季连衣裙 ",
      name_en: " Summer Dresses ",
      name_gr: " Καλοκαιρινά Φορέματα ",
      sort_order: 1,
      is_active: true,
      _is_new: true,
    }],
    deletedCategoryIds: [] as string[],
    deletedSubcategoryIds: [] as string[],
  };
}

test("category catalog accepts a new parent and child with stable client UUIDs", () => {
  const parsed = parseCategoryCatalogMutation(validMutation());
  assert.equal(parsed.categories[0].slug, "women");
  assert.equal(parsed.categories[0].name_cn, "女装");
  assert.equal(parsed.subcategories[0].category_id, categoryId);
  assert.equal(parsed.subcategories[0].slug, "summer-dresses");
  assert.equal("_is_new" in parsed.categories[0], false);
});

test("category catalog rejects incomplete customer-facing names", () => {
  const input = validMutation();
  input.categories[0].name_gr = "";
  assert.throws(() => parseCategoryCatalogMutation(input), CategoryCatalogInputError);
});

test("category catalog rejects duplicate category and subcategory slugs", () => {
  const duplicateCategory = validMutation();
  duplicateCategory.categories.push({
    ...duplicateCategory.categories[0],
    id: secondCategoryId,
    name_cn: "另一个分类",
  });
  assert.throws(() => parseCategoryCatalogMutation(duplicateCategory), /一级分类 slug 不能重复/);

  const duplicateSubcategory = validMutation();
  duplicateSubcategory.subcategories.push({
    ...duplicateSubcategory.subcategories[0],
    id: secondCategoryId,
    name_cn: "另一个二级分类",
  });
  assert.throws(() => parseCategoryCatalogMutation(duplicateSubcategory), /二级分类 slug 不能重复/);
});

test("category catalog rejects orphaned subcategories", () => {
  const input = validMutation();
  input.subcategories[0].category_id = secondCategoryId;
  assert.throws(() => parseCategoryCatalogMutation(input), /没有对应的一级分类/);
});

test("category catalog rejects unsafe image URLs and invalid slugs", () => {
  const unsafeImage = validMutation();
  unsafeImage.categories[0].image_url = "javascript:alert(1)";
  assert.throws(() => parseCategoryCatalogMutation(unsafeImage), /只允许 http 或 https/);

  const invalidSlug = validMutation();
  invalidSlug.categories[0].slug = "women--sale";
  assert.throws(() => parseCategoryCatalogMutation(invalidSlug), /slug 只允许/);
});

test("category catalog rejects saving and deleting the same row", () => {
  const input = validMutation();
  input.deletedCategoryIds = [categoryId];
  assert.throws(() => parseCategoryCatalogMutation(input), /不能同时保存和删除/);
});
