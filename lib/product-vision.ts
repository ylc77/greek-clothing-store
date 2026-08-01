// This limits one AI analysis request, not how many gallery images a product may store.
// A main image plus one back/detail view is sufficient for catalog copy and keeps API usage bounded.
export const MAX_PRODUCT_VISION_IMAGES = 2;
export const MAX_PRODUCT_VISION_PAYLOAD_BYTES = 16 * 1024;
export const MAX_PRODUCT_VISION_OUTPUT_BYTES = 64 * 1024;

export type ProductVisionHints = {
  sku: string;
  name_cn: string;
  description_cn: string;
  category: string;
  subcategory: string;
  color: string;
  brand: string;
  material: string;
  sizes: string;
  notes: string;
  use_stored_images: boolean;
};

export type ProductVisionResult = {
  name_cn: string;
  description_cn: string;
  name_en: string;
  description_en: string;
  name_gr: string;
  description_gr: string;
  fit_type: "regular" | "slim" | "loose";
  material: string;
  material_evidence: "label_visible" | "owner_provided" | "visual_guess" | "unknown";
  ai_keywords: string[];
  style_tags: string[];
  visual_summary: string;
};

export class ProductVisionError extends Error {
  readonly code: "INVALID_INPUT" | "INVALID_UPSTREAM_RESPONSE" | "UPSTREAM_RESPONSE_TOO_LARGE";

  constructor(code: ProductVisionError["code"], message: string) {
    super(message);
    this.name = "ProductVisionError";
    this.code = code;
  }
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function parseProductVisionHints(value: unknown): ProductVisionHints {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductVisionError("INVALID_INPUT", "商品资料格式无效。");
  }
  const source = value as Record<string, unknown>;
  return {
    sku: cleanText(source.sku, 120),
    name_cn: cleanText(source.name_cn, 120),
    description_cn: cleanText(source.description_cn, 500),
    category: cleanText(source.category, 60),
    subcategory: cleanText(source.subcategory, 80),
    color: cleanText(source.color, 120),
    brand: cleanText(source.brand, 80),
    material: cleanText(source.material, 120),
    sizes: cleanText(source.sizes, 160),
    notes: cleanText(source.notes, 500),
    use_stored_images: source.use_stored_images === true,
  };
}

export const productVisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name_cn",
    "description_cn",
    "name_en",
    "description_en",
    "name_gr",
    "description_gr",
    "fit_type",
    "material",
    "material_evidence",
    "ai_keywords",
    "style_tags",
    "visual_summary",
  ],
  properties: {
    name_cn: { type: "string" },
    description_cn: { type: "string" },
    name_en: { type: "string" },
    description_en: { type: "string" },
    name_gr: { type: "string" },
    description_gr: { type: "string" },
    fit_type: { type: "string", enum: ["regular", "slim", "loose"] },
    material: { type: "string" },
    material_evidence: { type: "string", enum: ["label_visible", "owner_provided", "visual_guess", "unknown"] },
    ai_keywords: { type: "array", maxItems: 8, items: { type: "string" } },
    style_tags: { type: "array", maxItems: 5, items: { type: "string" } },
    visual_summary: { type: "string" },
  },
} as const;

function cleanList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => cleanText(item, 40)).filter(Boolean))).slice(0, maxItems);
}

export function parseProductVisionResult(value: string | unknown): ProductVisionResult {
  const raw = typeof value === "string" ? value : JSON.stringify(value) || "";
  if (Buffer.byteLength(raw, "utf8") > MAX_PRODUCT_VISION_OUTPUT_BYTES) {
    throw new ProductVisionError("UPSTREAM_RESPONSE_TOO_LARGE", "AI 返回内容超过安全限制。");
  }
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 未返回有效的商品资料。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 商品资料结构无效。");
  }
  const source = parsed as Record<string, unknown>;
  const fitType = source.fit_type;
  const materialEvidence = source.material_evidence;
  if (!['regular', 'slim', 'loose'].includes(String(fitType))) {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 返回了无效的版型。");
  }
  if (!['label_visible', 'owner_provided', 'visual_guess', 'unknown'].includes(String(materialEvidence))) {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 返回了无效的材质依据。");
  }
  const trustedMaterial = materialEvidence === "label_visible" || materialEvidence === "owner_provided";
  const result: ProductVisionResult = {
    name_cn: cleanText(source.name_cn, 120),
    description_cn: cleanText(source.description_cn, 500),
    name_en: cleanText(source.name_en, 120),
    description_en: cleanText(source.description_en, 500),
    name_gr: cleanText(source.name_gr, 120),
    description_gr: cleanText(source.description_gr, 500),
    fit_type: fitType as ProductVisionResult["fit_type"],
    material: trustedMaterial ? cleanText(source.material, 120) : "",
    material_evidence: materialEvidence as ProductVisionResult["material_evidence"],
    ai_keywords: cleanList(source.ai_keywords, 8),
    style_tags: cleanList(source.style_tags, 5),
    visual_summary: cleanText(source.visual_summary, 300),
  };
  if (!result.name_cn || !result.name_en || !result.name_gr) {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 返回的商品名称不完整。");
  }
  return result;
}

export function extractResponsesOutputText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "OpenAI 返回结构无效。");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.output_text === "string" && source.output_text.trim()) return source.output_text;
  const output = Array.isArray(source.output) ? source.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      if (record.type === "refusal") {
        throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 拒绝处理这组图片，请更换清晰的商品照片。");
      }
      if (record.type === "output_text" && typeof record.text === "string") texts.push(record.text);
    }
  }
  const text = texts.join("\n").trim();
  if (!text) throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "OpenAI 未返回商品资料。");
  if (Buffer.byteLength(text, "utf8") > MAX_PRODUCT_VISION_OUTPUT_BYTES) {
    throw new ProductVisionError("UPSTREAM_RESPONSE_TOO_LARGE", "AI 返回内容超过安全限制。");
  }
  return text;
}

export function buildProductVisionPrompt(hints: ProductVisionHints, imageCount: number) {
  return [
    "You are preparing catalog data for a small physical fashion boutique in Athens, Greece.",
    imageCount > 0
      ? `Inspect the ${imageCount} attached product photo(s) as views of the same item. Describe only visible, reliable details.`
      : "No image is attached. Use only the owner-provided catalog hints.",
    "Generate concise Chinese admin copy plus natural English and modern Greek storefront copy.",
    "Never invent price, discount, stock, size availability, barcode, EAN, MPN, SKU, brand, origin, certification, waterproofing, or delivery promises.",
    "Do not identify a person or infer sensitive traits from an image. Focus only on the garment or accessory.",
    "Exact fiber composition cannot be determined from appearance. Set material_evidence to label_visible only when a readable composition label is visible, owner_provided only when the material hint explicitly provides it, visual_guess for appearance-only guesses, otherwise unknown.",
    "When material_evidence is visual_guess or unknown, return an empty material string.",
    "Color is owner-managed optional catalog data. Do not infer, generate, translate, or change any color value or color variant.",
    "fit_type must be regular, slim, or loose. Use regular when the cut cannot be determined reliably.",
    "Product names should be clear searchable retail titles, without clickbait, emojis, ALL CAPS, or invented brands.",
    "Descriptions should be 1-2 short sentences and may mention visible cut, styling, and suitable occasions without making unsupported claims.",
    `Existing Chinese name: ${hints.name_cn || "-"}`,
    `Existing Chinese description: ${hints.description_cn || "-"}`,
    `Catalog category: ${hints.category || "-"} / ${hints.subcategory || "-"}`,
    `Owner-entered color: ${hints.color || "-"}`,
    `Owner-entered brand: ${hints.brand || "-"}`,
    `Owner-entered material: ${hints.material || "-"}`,
    `Stored size labels (do not change): ${hints.sizes || "-"}`,
    `Owner notes: ${hints.notes || "-"}`,
  ].join("\n");
}

export function buildOpenAiProductVisionBody(options: {
  model: string;
  prompt: string;
  imageDataUrls: string[];
}) {
  return {
    model: options.model,
    store: false,
    max_output_tokens: 800,
    reasoning: { effort: "none" },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: options.prompt },
        ...options.imageDataUrls.slice(0, MAX_PRODUCT_VISION_IMAGES).map(imageUrl => ({
          type: "input_image",
          image_url: imageUrl,
          detail: "high",
        })),
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "product_vision_catalog_data",
        strict: true,
        schema: productVisionJsonSchema,
      },
    },
  };
}
