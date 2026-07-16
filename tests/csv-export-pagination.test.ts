import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { buildProductCsvExport, createCsvDownloadHeaders, csvTextCell, groupVariantsByProductId, neutralizeSpreadsheetFormula, productCsvValue } from "../lib/csv-output.ts";

type ExportPage<T> = {
  data: T[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
};

type ProductFixture = {
  id: number;
  sku: string;
  name_cn: string;
  size_chart?: Record<string, unknown> | null;
};

type VariantFixture = {
  id: string;
  product_id: number | string;
  size: string;
  supplier_sku: string;
  cost_price: number;
  reorder_level: number;
};

function paged<T>(rows: T[], calls: Array<[number, number]>) {
  return async (from: number, to: number): Promise<ExportPage<T>> => {
    calls.push([from, to]);
    return {
      data: rows.slice(from, to + 1),
      count: rows.length,
      error: null,
    };
  };
}

function emptyPage<T>(): Promise<ExportPage<T>> {
  return Promise.resolve({ data: [], count: 0, error: null });
}

function headerValue(headers: Headers | Record<string, string>, name: string) {
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

test("product export paginates past 1000 products and 5000 variants without truncation", async () => {
  const products: ProductFixture[] = Array.from({ length: 1001 }, (_, index) => ({
    id: index + 1,
    sku: `SKU-${String(index).padStart(4, "0")}`,
    name_cn: `Product ${index}`,
  }));
  const variants: VariantFixture[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `variant-${index}`,
    product_id: (index % products.length) + 1,
    size: `SIZE-${index}`,
    supplier_sku: `SUP-${index}`,
    cost_price: index / 100,
    reorder_level: index % 5,
  }));
  const productCalls: Array<[number, number]> = [];
  const variantCalls: Array<[number, number]> = [];

  const result = await buildProductCsvExport({
    pageSize: 500,
    fetchProductsPage: paged(products, productCalls),
    fetchVariantsPage: paged(variants, variantCalls),
    now: new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.equal(result.productCount, 1001);
  assert.equal(result.variantCount, 5000);
  assert.equal(result.csv.trimEnd().split(/\r?\n/).length, 1002, "header plus all 1001 products must be present");
  assert.match(result.csv, /SKU-1000/);
  assert.match(result.csv, /SUP-4999/);
  assert.deepEqual(productCalls, [[0, 499], [500, 999], [1000, 1499]]);
  assert.equal(variantCalls.length, 10);
  assert.deepEqual(variantCalls.at(-1), [4500, 4999]);
});

test("variants are grouped once in a Map keyed by normalized product_id", () => {
  const grouped = groupVariantsByProductId<VariantFixture>([
    { id: "v1", product_id: 7, size: "S", supplier_sku: "SUP-S", cost_price: 1, reorder_level: 1 },
    { id: "v2", product_id: "7", size: "M", supplier_sku: "SUP-M", cost_price: 2, reorder_level: 2 },
    { id: "v3", product_id: 8, size: "ONE SIZE", supplier_sku: "SUP-O", cost_price: 3, reorder_level: 3 },
  ]);

  assert.ok(grouped instanceof Map);
  assert.deepEqual(grouped.get("7")?.map((variant) => variant.id), ["v1", "v2"]);
  assert.deepEqual(grouped.get("8")?.map((variant) => variant.id), ["v3"]);
});

for (const failingEntity of ["products", "variants"] as const) {
  test(`${failingEntity} page failure aborts the export and returns no CSV`, async () => {
    const rows = failingEntity === "products"
      ? [{ id: 1, sku: "SKU-1", name_cn: "one" }, { id: 2, sku: "SKU-2", name_cn: "two" }]
      : [
          { id: "v1", product_id: 1, size: "S", supplier_sku: "SUP-S", cost_price: 1, reorder_level: 1 },
          { id: "v2", product_id: 1, size: "M", supplier_sku: "SUP-M", cost_price: 1, reorder_level: 1 },
        ];
    let completedResult: Awaited<ReturnType<typeof buildProductCsvExport>> | undefined;
    const failingFetcher = async (from: number, to: number): Promise<ExportPage<(typeof rows)[number]>> => {
      if (from > 0) {
        return { data: null, count: rows.length, error: { code: "PGRST_TEST", message: "injected page failure" } };
      }
      return { data: rows.slice(from, to + 1), count: rows.length, error: null };
    };

    await assert.rejects(
      async () => {
        completedResult = await buildProductCsvExport({
          pageSize: 1,
          fetchProductsPage: failingEntity === "products" ? failingFetcher : async () => ({ data: [{ id: 1, sku: "SKU-1", name_cn: "one" }], count: 1, error: null }),
          fetchVariantsPage: failingEntity === "variants" ? failingFetcher : emptyPage,
          now: new Date("2026-07-16T00:00:00.000Z"),
        });
      },
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "CSV_EXPORT_PAGE_FAILED"),
    );
    assert.equal(completedResult, undefined, "a partial CSV must never be returned after a page error");
  });
}

for (const mismatchedEntity of ["products", "variants"] as const) {
  test(`${mismatchedEntity} total mismatch aborts the export and returns no CSV`, async () => {
    const products = [{ id: 1, sku: "SKU-1", name_cn: "one" }];
    const variants = [{ id: "v1", product_id: 1, size: "S", supplier_sku: "SUP-S", cost_price: 1, reorder_level: 1 }];
    let completedResult: Awaited<ReturnType<typeof buildProductCsvExport>> | undefined;
    const mismatchedProducts = async (from: number): Promise<ExportPage<ProductFixture>> => ({
      data: from === 0 ? products : [],
      count: 2,
      error: null,
    });
    const mismatchedVariants = async (from: number): Promise<ExportPage<VariantFixture>> => ({
      data: from === 0 ? variants : [],
      count: 2,
      error: null,
    });

    await assert.rejects(
      async () => {
        completedResult = await buildProductCsvExport({
          pageSize: 1,
          fetchProductsPage: mismatchedEntity === "products" ? mismatchedProducts : async () => ({ data: products, count: 1, error: null }),
          fetchVariantsPage: mismatchedEntity === "variants" ? mismatchedVariants : async () => ({ data: variants, count: 1, error: null }),
          now: new Date("2026-07-16T00:00:00.000Z"),
        });
      },
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "CSV_EXPORT_COUNT_MISMATCH"),
    );
    assert.equal(completedResult, undefined, "a count mismatch must not return a plausible partial CSV");
  });
}

test("size_chart is serialized as faithful JSON instead of a numeric object map", async () => {
  const sizeChart = {
    S: { bust: "84-88", note: "comma, quote \" and newline\nkept" },
    M: { bust: "88-92", length: 61 },
  };
  assert.equal(productCsvValue("size_chart", sizeChart), JSON.stringify(sizeChart));

  const result = await buildProductCsvExport({
    pageSize: 100,
    fetchProductsPage: async () => ({ data: [{ id: 1, sku: "SKU-1", name_cn: "one", size_chart: sizeChart }], count: 1, error: null }),
    fetchVariantsPage: emptyPage,
    now: new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.ok(result.csv.includes(csvTextCell(JSON.stringify(sizeChart))), "the complete JSON value must survive CSV quoting");
});

test("spreadsheet formula prefixes are neutralized while preserving the original text", () => {
  const dangerous = [
    "=HYPERLINK(\"https://example.test\",\"click\")",
    "+CMD",
    "-1+2",
    "@SUM(A1:A2)",
    "\t=SUM(A1:A2)",
    "\r=SUM(A1:A2)",
    "   =SUM(A1:A2)",
  ];

  for (const value of dangerous) {
    assert.equal(neutralizeSpreadsheetFormula(value), `'${value}`);
  }
  assert.equal(neutralizeSpreadsheetFormula("ordinary text"), "ordinary text");
  assert.equal(neutralizeSpreadsheetFormula("123.45"), "123.45");

  const combined = "=HYPERLINK(\"https://example.test\",\"click\"),\nnext";
  assert.equal(
    csvTextCell(combined),
    `"'=HYPERLINK(""https://example.test"",""click""),\nnext"`,
    "formula neutralization must compose with quote, comma, and newline escaping",
  );
});

test("download headers disable caching and prevent filename header injection", () => {
  const headers = createCsvDownloadHeaders("products-export-\r\nX-Evil: yes/../\".csv");
  const disposition = headerValue(headers, "Content-Disposition");

  assert.equal(headerValue(headers, "Cache-Control"), "no-store");
  assert.match(headerValue(headers, "Content-Type") || "", /^text\/csv\b/i);
  assert.ok(disposition?.startsWith("attachment;"));
  assert.doesNotMatch(disposition || "", /[\r\n]/);
  assert.match(disposition || "", /filename="[^"\\/]+"/);
});
