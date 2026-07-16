import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { fetchAllSupabaseRows } from "../lib/supabase-pagination.ts";

test("fetchAllSupabaseRows returns every row beyond the Supabase 1000-row response limit", async () => {
  const source = Array.from({ length: 2_305 }, (_, index) => ({ id: index + 1 }));
  const ranges: Array<[number, number]> = [];

  const result = await fetchAllSupabaseRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.length, source.length);
  assert.equal(result.data?.at(-1)?.id, 2_305);
  assert.deepEqual(ranges, [[0, 999], [1_000, 1_999], [2_000, 2_999]]);
});

test("fetchAllSupabaseRows does not return a partial result when a later page fails", async () => {
  const result = await fetchAllSupabaseRows(async (from) => (
    from === 0
      ? { data: Array.from({ length: 1_000 }, (_, index) => index), error: null }
      : { data: null, error: { message: "Bad Request" } }
  ));

  assert.equal(result.data, null);
  assert.equal(result.error?.message, "Bad Request");
});

test("fetchAllSupabaseRows rejects unsafe page sizes", async () => {
  await assert.rejects(() => fetchAllSupabaseRows(async () => ({ data: [], error: null }), 1_001), RangeError);
  await assert.rejects(() => fetchAllSupabaseRows(async () => ({ data: [], error: null }), 0), RangeError);
});
