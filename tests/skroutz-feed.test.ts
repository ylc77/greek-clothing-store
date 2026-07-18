import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser } from "fast-xml-parser";

import {
  assembleSkroutzFeedProducts,
  buildSkroutzFeed,
  stripInvalidXmlCharacters,
  type SkroutzBalanceRow,
  type SkroutzProductRow,
  type SkroutzVariantRow,
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
} from "../lib/skroutz-feed.ts";

function product(overrides: Partial<SkroutzProductRow> = {}): SkroutzProductRow {
  return {
    id: 1,
    sku: "DRESS-001",
    name_gr: "Φόρεμα",
    name_en: "Summer Dress",
    description_gr: "Καλοκαιρινό φόρεμα",
    description_en: "Summer dress",
    category: "women",
    subcategory: "dresses",
    price: 39.9,
    image_url: "https://cdn.example.test/dress.webp",
    image_urls: ["https://cdn.example.test/dress-back.webp"],
    additional_image_urls: null,
    image_width: 1200,
    image_height: 1500,
    brand: "Example Brand",
    ean: "5201234567890",
    vat: 24,
    color: "Blue",
    mpn: "DRESS-001",
    availability: "In stock",
    country_of_origin: "Greece",
    category_path_en: "Women > Dresses",
    is_active: true,
    created_at: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function variant(overrides: Partial<SkroutzVariantRow> = {}): SkroutzVariantRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    product_id: 1,
    variant_sku: "DRESS-001-S",
    barcode: "5201234567890",
    size: "S",
    color: "Blue",
    price: 39.9,
    active: true,
    ...overrides,
  };
}

function balance(overrides: Partial<SkroutzBalanceRow> = {}): SkroutzBalanceRow {
  return {
    variant_id: "11111111-1111-4111-8111-111111111111",
    location_code: "MAIN_STORE",
    quantity_on_hand: 3,
    quantity_reserved: 1,
    ...overrides,
  };
}

test("Skroutz feed uses authoritative MAIN_STORE availability and emits only saleable size variations", () => {
  const products = [product()];
  const variants = [
    variant(),
    variant({
      id: "22222222-2222-4222-8222-222222222222",
      variant_sku: "DRESS-001-M",
      barcode: "5201234567891",
      size: "M",
    }),
    variant({
      id: "33333333-3333-4333-8333-333333333333",
      variant_sku: "DRESS-001-L",
      barcode: "5201234567892",
      size: "L",
      active: false,
    }),
  ];
  const balances = [
    balance(),
    balance({
      variant_id: "22222222-2222-4222-8222-222222222222",
      quantity_on_hand: 1,
      quantity_reserved: 1,
    }),
    balance({
      variant_id: "33333333-3333-4333-8333-333333333333",
      quantity_on_hand: 9,
      quantity_reserved: 0,
    }),
  ];

  const assembled = assembleSkroutzFeedProducts(products, variants, balances, 1);
  assert.equal(assembled.length, 1);
  assert.equal(assembled[0].quantity, 2);
  assert.deepEqual(assembled[0].variants.map((item) => item.size), ["S"]);

  const xml = buildSkroutzFeed(assembled, "Example Store", new Date("2026-07-18T12:34:00.000Z"));
  assert.match(xml, /<size>S<\/size>/);
  assert.doesNotMatch(xml, /<size>M<\/size>/);
  assert.doesNotMatch(xml, /<size>L<\/size>/);
  assert.match(xml, /<quantity>2<\/quantity>/);
  assert.match(xml, /<variationid>DRESS-001-S<\/variationid>/);
  assert.match(xml, /<name>Example Brand Summer Dress<\/name>/);
});

test("Skroutz feed strips XML 1.0 control characters and escapes markup", () => {
  assert.equal(stripInvalidXmlCharacters("A\u0000B\u0008C\tD"), "ABC\tD");
  const assembled = assembleSkroutzFeedProducts(
    [product({ name_en: "Dress\u0000 & <Summer>", description_en: "Safe\u0008 text", brand: "Store & Co" })],
    [variant()],
    [balance({ quantity_reserved: 0 })],
    1,
    "https://example.invalid",
    "Store & Co",
  );
  const xml = buildSkroutzFeed(assembled, "Store & Co", new Date("2026-07-18T12:34:00.000Z"));
  assert.doesNotMatch(xml, /\u0000|\u0008/);
  assert.match(xml, /Dress &amp; &lt;Summer&gt;/);
  assert.match(xml, /Store &amp; Co/);
});

test("Skroutz feed excludes insecure URLs, test SKUs, and products below minimum saleable stock", () => {
  const rows = assembleSkroutzFeedProducts(
    [
      product({ id: 1, sku: "DRESS-001" }),
      product({ id: 2, sku: "TEST-DRESS", image_url: "https://cdn.example.test/test.webp" }),
      product({ id: 3, sku: "HTTP-DRESS", image_url: "http://cdn.example.test/http.webp" }),
    ],
    [
      variant({ product_id: 1 }),
      variant({ id: "22222222-2222-4222-8222-222222222222", product_id: 2, variant_sku: "TEST-DRESS-S" }),
      variant({ id: "33333333-3333-4333-8333-333333333333", product_id: 3, variant_sku: "HTTP-DRESS-S" }),
    ],
    [
      balance(),
      balance({ variant_id: "22222222-2222-4222-8222-222222222222" }),
      balance({ variant_id: "33333333-3333-4333-8333-333333333333" }),
    ],
    3,
  );

  assert.deepEqual(rows, []);
});

test("Skroutz feed excludes unknown manufacturers, non-English copy, and undersized images", () => {
  const variants = [variant()];
  const balances = [balance({ quantity_reserved: 0 })];
  assert.deepEqual(assembleSkroutzFeedProducts([product({ brand: null })], variants, balances), []);
  assert.deepEqual(assembleSkroutzFeedProducts([product({ name_en: null })], variants, balances), []);
  assert.deepEqual(assembleSkroutzFeedProducts([product({ description_en: null })], variants, balances), []);
  assert.deepEqual(assembleSkroutzFeedProducts([product({ image_width: 1000, image_height: 999 })], variants, balances), []);
});

test("Skroutz feed excludes sized products whose saleable stock cannot be mapped to a size variation", () => {
  const variants = [
    variant(),
    variant({
      id: "22222222-2222-4222-8222-222222222222",
      variant_sku: "DRESS-001-UNKNOWN",
      size: null,
    }),
  ];
  const balances = [
    balance({ quantity_reserved: 0 }),
    balance({
      variant_id: "22222222-2222-4222-8222-222222222222",
      quantity_on_hand: 2,
      quantity_reserved: 0,
    }),
  ];

  assert.deepEqual(assembleSkroutzFeedProducts([product()], variants, balances), []);
});

test("Skroutz feed retains more than one Supabase page of products", () => {
  const products = Array.from({ length: 1_005 }, (_, index) => product({
    id: index + 1,
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    ean: String(5_200_000_000_000 + index),
    mpn: `MPN-${index + 1}`,
  }));
  const variants = products.map((item, index) => variant({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    product_id: item.id,
    variant_sku: `${item.sku}-ONE-SIZE`,
    barcode: item.ean,
    size: "ONE SIZE",
  }));
  const balances = variants.map((item) => balance({ variant_id: item.id, quantity_reserved: 0 }));

  const assembled = assembleSkroutzFeedProducts(products, variants, balances, 1);
  assert.equal(assembled.length, 1_005);
  const xml = buildSkroutzFeed(assembled, "Example Store", new Date("2026-07-18T12:34:00.000Z"));
  assert.equal((xml.match(/<product>/g) || []).length, 1_005);
  assert.match(xml, /<id>SKU-1005<\/id>/);
  const parsed = new XMLParser().parse(xml) as {
    mywebstore?: { products?: { product?: unknown[] } };
  };
  assert.equal(parsed.mywebstore?.products?.product?.length, 1_005);
});
