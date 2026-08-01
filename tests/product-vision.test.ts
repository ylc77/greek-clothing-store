import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { MAX_PRODUCT_VISION_IMAGES, ProductVisionError, buildOpenAiProductVisionBody, buildProductVisionPrompt, extractResponsesOutputText, parseProductVisionHints, parseProductVisionResult, productVisionJsonSchema } from "../lib/product-vision.ts";

const validResult = {
  name_cn: "女士蓝色连衣裙",
  description_cn: "简洁的日常连衣裙。",
  name_en: "Women's Blue Midi Dress",
  description_en: "A clean everyday midi dress.",
  name_gr: "Γυναικείο Μπλε Μίντι Φόρεμα",
  description_gr: "Ένα κομψό μίντι φόρεμα για κάθε μέρα.",
  fit_type: "regular",
  material: "",
  material_evidence: "unknown",
  ai_keywords: ["blue dress", "midi dress"],
  style_tags: ["casual", "minimal"],
  visual_summary: "Blue midi dress with short sleeves.",
};

test("product vision hints are bounded and ignore browser-only extra fields", () => {
  const parsed = parseProductVisionHints({
    sku: " DRESS-001 ",
    notes: "x".repeat(1_000),
    cost_price: 1,
    supplier_sku: "PRIVATE",
    use_stored_images: true,
  });
  assert.equal(parsed.sku, "DRESS-001");
  assert.equal(parsed.notes.length, 500);
  assert.equal(parsed.use_stored_images, true);
  assert.equal("cost_price" in parsed, false);
  assert.equal("supplier_sku" in parsed, false);
});

test("vision request uses strict schema, high detail, and the bounded image batch", () => {
  const body = buildOpenAiProductVisionBody({
    model: "gpt-5.6-luna",
    prompt: "inspect item",
    imageDataUrls: Array.from({ length: MAX_PRODUCT_VISION_IMAGES + 2 }, (_, index) => `data:image/webp;base64,${index}`),
  });
  assert.equal(body.store, false);
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.reasoning.effort, "none");
  assert.equal(body.max_output_tokens, 800);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema, productVisionJsonSchema);
  assert.equal("category" in productVisionJsonSchema.properties, false);
  assert.equal("subcategory" in productVisionJsonSchema.properties, false);
  assert.equal("primary_color" in productVisionJsonSchema.properties, false);
  const content = body.input[0].content;
  const imageContent = content.filter((item): item is { type: string; image_url: string; detail: string } => item.type === "input_image" && "detail" in item);
  assert.equal(imageContent.length, MAX_PRODUCT_VISION_IMAGES);
  assert.ok(imageContent.every(item => item.detail === "high"));
});

test("appearance-only material guesses are never returned as catalog material", () => {
  const parsed = parseProductVisionResult({
    ...validResult,
    material: "cotton",
    material_evidence: "visual_guess",
  });
  assert.equal(parsed.material, "");
  assert.equal(parsed.material_evidence, "visual_guess");

  const labelResult = parseProductVisionResult({
    ...validResult,
    material: "100% cotton",
    material_evidence: "label_visible",
  });
  assert.equal(labelResult.material, "100% cotton");
});

test("vision result rejects invalid enums, incomplete names, and oversized output", () => {
  assert.throws(
    () => parseProductVisionResult({ ...validResult, fit_type: "oversized-ish" }),
    (error: unknown) => error instanceof ProductVisionError && error.code === "INVALID_UPSTREAM_RESPONSE",
  );
  assert.throws(
    () => parseProductVisionResult({ ...validResult, name_gr: "" }),
    (error: unknown) => error instanceof ProductVisionError && error.code === "INVALID_UPSTREAM_RESPONSE",
  );
  assert.throws(
    () => parseProductVisionResult("x".repeat(65_537)),
    (error: unknown) => error instanceof ProductVisionError && error.code === "UPSTREAM_RESPONSE_TOO_LARGE",
  );
});

test("Responses API output text is extracted and refusals are rejected", () => {
  const text = JSON.stringify(validResult);
  assert.equal(extractResponsesOutputText({
    output: [{ content: [{ type: "output_text", text }] }],
  }), text);
  assert.throws(
    () => extractResponsesOutputText({ output: [{ content: [{ type: "refusal", refusal: "no" }] }] }),
    (error: unknown) => error instanceof ProductVisionError && error.code === "INVALID_UPSTREAM_RESPONSE",
  );
});

test("prompt prohibits AI-generated inventory, barcode, size, color, and material guesses", () => {
  const prompt = buildProductVisionPrompt(parseProductVisionHints({
    category: "women",
    subcategory: "dresses",
    sizes: "S,M,L",
  }), 2);
  assert.match(prompt, /Never invent price.*stock.*size availability.*barcode/i);
  assert.match(prompt, /Color is owner-managed optional catalog data/i);
  assert.match(prompt, /Exact fiber composition cannot be determined from appearance/i);
  assert.match(prompt, /Stored size labels \(do not change\): S,M,L/);
});
