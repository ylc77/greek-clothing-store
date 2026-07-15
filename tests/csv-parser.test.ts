import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import {
  CsvInputError,
  parseProductCsvBytes,
  parseStrictCsvBoolean,
  parseStrictCsvJson,
  parseStrictCsvNumber,
  parseStrictSizeStock,
} from "../lib/csv-parser.ts";

const encoder = new TextEncoder();
const aliases = { "product sku": "sku", title: "name_cn" };
const options = {
  allowedHeaders: ["sku", "name_cn", "category", "subcategory", "price", "notes", "tail"],
  requiredHeaders: ["sku", "name_cn", "category", "subcategory", "price"],
  headerAliases: aliases,
  importMode: "create_only" as const,
  inventoryMode: "metadata_only" as const,
};

function bytes(value: string) {
  return encoder.encode(value);
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof CsvInputError && error.code === code;
}

test("strict parser handles BOM, CRLF, quoted commas/newlines, escaped quotes, blank lines, and trailing empty cells", () => {
  const input = "\uFEFFProduct SKU,TITLE,CATEGORY,SUBCATEGORY,PRICE,notes,tail\r\n"
    + ' Dress-001 ,"Summer, dress",women,dresses,39.9,"line 1\r\nline 2 with ""quotes""",\r\n\r\n';
  const parsed = parseProductCsvBytes(bytes(input), options);

  assert.deepEqual(parsed.headers, ["sku", "name_cn", "category", "subcategory", "price", "notes", "tail"]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.rowNumber, 2);
  assert.equal(parsed.rows[0]?.normalizedSku, "dress-001");
  assert.equal(parsed.rows[0]?.values.name_cn, "Summer, dress");
  assert.equal(parsed.rows[0]?.values.notes, 'line 1\nline 2 with "quotes"');
  assert.equal(parsed.rows[0]?.values.tail, "");
  assert.equal(parsed.importMode, "create_only");
  assert.equal(parsed.inventoryMode, "metadata_only");
});

test("header aliases are case-insensitive and duplicate aliases, unknown headers, and missing required headers reject the whole file", () => {
  const valid = parseProductCsvBytes(bytes("PRODUCT SKU,Title,CATEGORY,SUBCATEGORY,PRICE\nA-1,Dress,women,dresses,10\n"), options);
  assert.deepEqual(valid.headers, ["sku", "name_cn", "category", "subcategory", "price"]);

  assert.throws(
    () => parseProductCsvBytes(bytes("sku,Product SKU,name_cn,category,subcategory,price\nA,A,Dress,women,dresses,10"), options),
    expectCode("CSV_DUPLICATE_HEADER"),
  );
  assert.throws(
    () => parseProductCsvBytes(bytes("sku,name_cn,category,subcategory,price,mystery\nA,Dress,women,dresses,10,x"), options),
    expectCode("CSV_UNKNOWN_HEADER"),
  );
  assert.throws(
    () => parseProductCsvBytes(bytes("name_cn,category,subcategory,price\nDress,women,dresses,10"), options),
    expectCode("CSV_MISSING_REQUIRED_HEADER"),
  );
});

test("malformed quotes, unmappable extra columns, invalid UTF-8, and normalized duplicate SKUs fail before rows are accepted", () => {
  assert.throws(
    () => parseProductCsvBytes(bytes('sku,name_cn,category,subcategory,price\nA,"broken,women,dresses,10'), options),
    expectCode("CSV_MALFORMED_QUOTES"),
  );
  assert.throws(
    () => parseProductCsvBytes(bytes("sku,name_cn,category,subcategory,price\nA,Dress,women,dresses,10,extra"), options),
    expectCode("CSV_COLUMN_COUNT_MISMATCH"),
  );
  assert.throws(
    () => parseProductCsvBytes(new Uint8Array([0x73, 0x6b, 0x75, 0x0a, 0xc3, 0x28]), options),
    expectCode("CSV_INVALID_UTF8"),
  );
  assert.throws(
    () => parseProductCsvBytes(bytes("sku,name_cn,category,subcategory,price\n Dress-1 ,One,women,dresses,10\ndress-1,Two,women,dresses,11"), options),
    expectCode("CSV_DUPLICATE_SKU"),
  );
});

test("file, row, column, and cell limits reject input before commit", () => {
  const base = "sku,name_cn,category,subcategory,price\nA,Dress,women,dresses,10";
  assert.throws(() => parseProductCsvBytes(bytes(base), { ...options, limits: { maxFileBytes: 10 } }), expectCode("CSV_FILE_TOO_LARGE"));
  assert.throws(() => parseProductCsvBytes(bytes(`${base}\nB,Top,women,tops,20`), { ...options, limits: { maxRows: 1 } }), expectCode("CSV_TOO_MANY_ROWS"));
  assert.throws(() => parseProductCsvBytes(bytes(base), { ...options, limits: { maxColumns: 4 } }), expectCode("CSV_TOO_MANY_COLUMNS"));
  assert.throws(() => parseProductCsvBytes(bytes(base), { ...options, limits: { maxCellChars: 4 } }), expectCode("CSV_CELL_TOO_LONG"));
  assert.throws(() => parseProductCsvBytes(bytes(base), { ...options, limits: { maxRowChars: 20 } }), expectCode("CSV_ROW_TOO_LONG"));
});

test("numeric parsing is exact and rejects formulas, partial values, non-finite values, fractional inventory, negatives, and range overflow", () => {
  assert.equal(parseStrictCsvNumber("39.90", { field: "price", min: 0, max: 1_000_000 }), 39.9);
  assert.equal(parseStrictCsvNumber("3", { field: "stock", integer: true, min: 0, max: 1_000_000 }), 3);
  for (const value of ["NaN", "Infinity", "€12", "12x", "=1+2", "1 2", "-1", "1.5", "1000001"]) {
    assert.throws(
      () => parseStrictCsvNumber(value, { field: "stock", integer: true, min: 0, max: 1_000_000 }),
      (error: unknown) => error instanceof CsvInputError && ["CSV_INVALID_NUMBER", "CSV_NUMBER_OUT_OF_RANGE"].includes(error.code),
      value,
    );
  }
});

test("boolean parser accepts only the documented whitelist", () => {
  for (const [raw, expected] of [["true", true], ["FALSE", false], ["1", true], ["0", false], ["yes", true], ["NO", false]] as const) {
    assert.equal(parseStrictCsvBoolean(raw, { field: "is_active" }), expected);
  }
  for (const raw of ["on", "truthy", "2", "", "null"]) {
    assert.throws(() => parseStrictCsvBoolean(raw, { field: "is_active" }), expectCode("CSV_INVALID_BOOLEAN"));
  }
});

test("size_stock is all-or-nothing and enforces unique declared sizes and integer quantities", () => {
  assert.deepEqual(parseStrictSizeStock("S:2,M:0,L:1", { sizes: ["S", "M", "L"], maxQuantity: 100 }), { S: 2, M: 0, L: 1 });
  for (const raw of ["S:2,M:BAD,L:1", "S:2,S:1", ":2", "S:-1", "S:1.5", "S=2", "S:101", "S:2,XL:1"]) {
    assert.throws(() => parseStrictSizeStock(raw, { sizes: ["S", "M", "L"], maxQuantity: 100 }), (error: unknown) => error instanceof CsvInputError, raw);
  }
});

test("JSON fields enforce schema, depth, item count, and string length", () => {
  assert.deepEqual(parseStrictCsvJson('["summer","linen"]', { field: "style_tags", schema: "string_array", maxDepth: 3, maxItems: 4, maxStringChars: 20 }), ["summer", "linen"]);
  assert.throws(() => parseStrictCsvJson('{"not":"an array"}', { field: "style_tags", schema: "string_array" }), expectCode("CSV_INVALID_JSON_SCHEMA"));
  assert.throws(() => parseStrictCsvJson('{"a":{"b":{"c":1}}}', { field: "size_chart", schema: "object", maxDepth: 2 }), expectCode("CSV_JSON_TOO_DEEP"));
  assert.throws(() => parseStrictCsvJson('["a","b","c"]', { field: "image_urls", schema: "string_array", maxItems: 2 }), expectCode("CSV_JSON_TOO_MANY_ITEMS"));
  assert.throws(() => parseStrictCsvJson('["toolong"]', { field: "ai_keywords", schema: "string_array", maxStringChars: 3 }), expectCode("CSV_JSON_STRING_TOO_LONG"));
});
