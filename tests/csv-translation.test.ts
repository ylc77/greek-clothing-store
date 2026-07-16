import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { batchTranslateRows, translateProductContent } from "../lib/translate.ts";

const originalFetch = globalThis.fetch;
const originalKey = process.env.DEEPSEEK_API_KEY;

function restore() {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
}

test.afterEach(restore);

test("translation is optional and an unconfigured provider performs no database or network work", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("must not run");
  }) as typeof fetch;

  const result = await translateProductContent({ name_cn: "连衣裙", description_cn: "" });
  assert.deepEqual(result, { ok: false, error: "DEEPSEEK_API_KEY is not configured." });
  assert.equal(called, false);
});

test("provider errors are sanitized instead of exposing the upstream response", async () => {
  process.env.DEEPSEEK_API_KEY = "temporary-test-key";
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { message: "raw upstream account and request detail" } }),
    { status: 429, headers: { "content-type": "application/json" } },
  )) as typeof fetch;

  const result = await translateProductContent({ name_cn: "连衣裙", description_cn: "" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "Translation provider rejected the request (429).");
    assert.doesNotMatch(result.error, /account|request detail/i);
  }
});

test("translation timeout returns a bounded row error without throwing or changing payload", async () => {
  process.env.DEEPSEEK_API_KEY = "temporary-test-key";
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  })) as typeof fetch;

  const rows = [{
    name_cn: "连衣裙",
    description_cn: "夏季",
    name_en: "",
    description_en: "",
    name_gr: "",
    description_gr: "",
  }];
  const result = await batchTranslateRows(rows, 1, { timeoutMs: 1_000 });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.translated, false);
  assert.equal(result[0]?.translateError, "Translation request timed out.");
  assert.deepEqual(rows[0], {
    name_cn: "连衣裙",
    description_cn: "夏季",
    name_en: "",
    description_en: "",
    name_gr: "",
    description_gr: "",
  });
});

test("already translated rows do not call the provider", async () => {
  process.env.DEEPSEEK_API_KEY = "temporary-test-key";
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("must not run");
  }) as typeof fetch;

  const result = await batchTranslateRows([{
    name_cn: "连衣裙",
    description_cn: "夏季",
    name_en: "Dress",
    description_en: "Summer",
    name_gr: "Φόρεμα",
    description_gr: "Καλοκαίρι",
  }]);
  assert.equal(result[0]?.translated, false);
  assert.equal(called, false);
});
