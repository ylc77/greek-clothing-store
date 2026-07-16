import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { csvCell, neutralizeCsvFormula, serializeCsv } from "../lib/csv-output.ts";

test("all spreadsheet formula prefixes, including leading whitespace, tab, and CR, are neutralized", () => {
  for (const value of ["=HYPERLINK(\"https://evil.test\")", "+CMD", "-1+2", "@SUM(A1:A2)", "\t=1+1", "\r=1+1", "   =1+1"]) {
    const safe = neutralizeCsvFormula(value);
    assert.equal(safe.startsWith("'"), true, value);
    assert.equal(safe.slice(1), value, "neutralization must preserve business text");
  }
  assert.equal(neutralizeCsvFormula("ordinary text"), "ordinary text");
});

test("CSV cells combine formula safety with quote, comma, and newline escaping", () => {
  assert.equal(csvCell('=HYPERLINK("x,y")\nnext'), '"\'=HYPERLINK(""x,y"")\nnext"');
  assert.equal(csvCell(-12.5), '"-12.5"', "validated numeric values remain numeric text");
  assert.equal(csvCell("-12.5"), '"\'-12.5"', "untyped text beginning with minus is neutralized");
});

test("product exports and failed-row reports share the same safe serializer", () => {
  const csv = serializeCsv(
    ["sku", "message"],
    [["=BAD", 'contains, comma and "quote"'], ["SAFE", "line 1\nline 2"]],
  );
  assert.equal(csv, '"sku","message"\r\n"\'=BAD","contains, comma and ""quote"""\r\n"SAFE","line 1\nline 2"\r\n');
});
