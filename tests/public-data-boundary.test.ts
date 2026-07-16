import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { serializeJsonForHtmlScript } from "../lib/serialize-json-for-html-script.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { ADMIN_PRIVATE_CACHE_CONTROL, shapeInventoryOverviewForRole, shapeProductForRole, shapeSupplierForRole } from "../lib/admin-data-boundary.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { AI_PRODUCT_COLUMNS, PUBLIC_PRODUCT_COLUMN_GRANT_COLUMNS, PUBLIC_PRODUCT_DETAIL_COLUMNS, PUBLIC_PRODUCT_LIST_COLUMNS, SKROUTZ_PRODUCT_COLUMNS, SITEMAP_PRODUCT_COLUMNS } from "../lib/product-data-boundary.ts";

test("JSON-LD serialization cannot escape its HTML script boundary and remains valid JSON", () => {
  const payload = {
    name: "</script><script>globalThis.__xss = true</script>",
    description: "<!-- HTML boundary --><img src=x onerror=alert(1)>",
    url: "https://example.test/product?x=<tag>&next=</script>",
    separators: `line${String.fromCodePoint(0x2028)}paragraph${String.fromCodePoint(0x2029)}end`,
  };

  const serialized = serializeJsonForHtmlScript(payload);

  assert.deepEqual(JSON.parse(serialized), payload);
  assert.doesNotMatch(serialized, /<\/script/i);
  assert.doesNotMatch(serialized, /[<>&]/u);
  assert.equal(serialized.includes(String.fromCodePoint(0x2028)), false);
  assert.equal(serialized.includes(String.fromCodePoint(0x2029)), false);
  assert.match(serialized, /\\u003c/i);
  assert.match(serialized, /\\u003e/i);
  assert.match(serialized, /\\u0026/i);
  assert.match(serialized, /\\u2028/i);
  assert.match(serialized, /\\u2029/i);
});

const productFixture = {
  id: 91,
  sku: "AUDIT-PUBLIC-DATA-1",
  name_gr: "Δοκιμή",
  name_en: "Test",
  supplier_id: "supplier-private-id",
  supplier_style_code: "STYLE-SECRET",
  metadata_version: 4,
  structure_version: 5,
  variants: [
    {
      id: "variant-id",
      variant_sku: "AUDIT-PUBLIC-DATA-1-M",
      size: "M",
      supplier_id: "supplier-private-id",
      supplier_sku: "SUPPLIER-SECRET-M",
      cost_price: 7.25,
      reorder_level: 2,
      quantity_on_hand: 5,
    },
  ],
  variant_procurement: {
    M: {
      supplier_sku: "SUPPLIER-SECRET-M",
      cost_price: 7.25,
      reorder_level: 2,
    },
  },
};

test("product responses expose full procurement only to owner", () => {
  const owner = shapeProductForRole(productFixture, "owner");
  assert.equal(owner.supplier_id, "supplier-private-id");
  assert.equal(owner.variants[0].cost_price, 7.25);
  assert.equal(owner.variant_procurement.M.cost_price, 7.25);

  for (const role of ["staff", "readonly"] as const) {
    const shaped = shapeProductForRole(productFixture, role);
    assert.equal("supplier_id" in shaped, false);
    assert.equal("supplier_style_code" in shaped, false);
    assert.equal("variant_procurement" in shaped, false);
    assert.equal("supplier_id" in shaped.variants[0], false);
    assert.equal("supplier_sku" in shaped.variants[0], false);
    assert.equal("cost_price" in shaped.variants[0], false);
    assert.equal("reorder_level" in shaped.variants[0], false);
  }

  const inventory = shapeProductForRole(productFixture, "inventory");
  assert.equal(inventory.supplier_id, "supplier-private-id");
  assert.equal(inventory.supplier_style_code, "STYLE-SECRET");
  assert.equal(inventory.variants[0].supplier_sku, "SUPPLIER-SECRET-M");
  assert.equal(inventory.variants[0].reorder_level, 2);
  assert.equal("cost_price" in inventory.variants[0], false);
  assert.equal("cost_price" in inventory.variant_procurement.M, false);
});

test("inventory responses give inventory role minimum procurement fields and no cost", () => {
  const result = {
    items: [{
      product_sku: "AUDIT-PUBLIC-DATA-1",
      supplier_sku: "SUPPLIER-SECRET-M",
      supplier_name: "Private Supplier",
      supplier_style_code: "STYLE-SECRET",
      cost_price: 7.25,
      reorder_level: 2,
      quantity_on_hand: 5,
    }],
    total: 1,
    limit: 100,
    offset: 0,
  };

  const owner = shapeInventoryOverviewForRole(result, "owner");
  assert.equal(owner.items[0].cost_price, 7.25);

  const inventory = shapeInventoryOverviewForRole(result, "inventory");
  assert.equal(inventory.items[0].supplier_sku, "SUPPLIER-SECRET-M");
  assert.equal(inventory.items[0].supplier_name, "Private Supplier");
  assert.equal(inventory.items[0].reorder_level, 2);
  assert.equal("cost_price" in inventory.items[0], false);

  for (const role of ["staff", "readonly"] as const) {
    const shaped = shapeInventoryOverviewForRole(result, role);
    for (const field of ["supplier_sku", "supplier_name", "supplier_style_code", "cost_price", "reorder_level"]) {
      assert.equal(field in shaped.items[0], false, `${role} leaked ${field}`);
    }
  }
});

test("supplier responses hide contact, tax and notes from inventory and deny implicit field reuse", () => {
  const supplier = {
    id: "supplier-private-id",
    code: "SUP-1",
    name: "Private Supplier",
    active: true,
    country: "GR",
    vat_number: "EL123456789",
    contact_name: "Private Person",
    phone: "+30 210 0000000",
    email: "private@example.test",
    address: "Private address",
    notes: "Internal negotiation notes",
  };

  assert.equal(shapeSupplierForRole(supplier, "owner").vat_number, "EL123456789");
  assert.deepEqual(shapeSupplierForRole(supplier, "inventory"), {
    id: "supplier-private-id",
    code: "SUP-1",
    name: "Private Supplier",
    active: true,
  });
});

test("public consumer column sets are explicit subsets of the database public grant", () => {
  const publicGrant = new Set<string>(PUBLIC_PRODUCT_COLUMN_GRANT_COLUMNS);
  const restricted = new Set([
    "name_cn",
    "description_cn",
    "barcode",
    "supplier_id",
    "supplier_style_code",
    "metadata_version",
    "structure_version",
    "create_model_version",
  ]);

  for (const [label, columns] of Object.entries({
    storefrontList: PUBLIC_PRODUCT_LIST_COLUMNS,
    storefrontDetail: PUBLIC_PRODUCT_DETAIL_COLUMNS,
    ai: AI_PRODUCT_COLUMNS,
    skroutz: SKROUTZ_PRODUCT_COLUMNS,
    sitemap: SITEMAP_PRODUCT_COLUMNS,
  })) {
    assert.equal(new Set(columns).size, columns.length, `${label} contains duplicate columns`);
    for (const column of columns) {
      assert.ok(publicGrant.has(column), `${label} column ${column} is not granted publicly`);
      assert.equal(restricted.has(column), false, `${label} contains restricted column ${column}`);
    }
  }

  for (const column of restricted) assert.equal(publicGrant.has(column), false, `public grant leaked ${column}`);
  assert.equal(ADMIN_PRIVATE_CACHE_CONTROL, "private, no-store, max-age=0");
});
