export type AiMeasurements = Partial<Record<"height" | "weight" | "bust" | "waist" | "hip" | "footLength" | "usualSize", number | string>>;

export type AiAssistantInput = {
  message: string;
  language: "en" | "el";
  privacyConsent: true;
  measurements?: AiMeasurements;
  productSku: string;
};

export type ConstrainedAiOutput = {
  reply: string;
  products: Array<{ sku: string; reason: string }>;
  sizeAdvice: string | null;
};

export class AiSecurityError extends Error {
  readonly code:
    | "PAYLOAD_TOO_LARGE"
    | "INVALID_INPUT"
    | "CONSENT_REQUIRED"
    | "INVALID_MEASUREMENTS"
    | "UPSTREAM_RESPONSE_TOO_LARGE"
    | "INVALID_UPSTREAM_RESPONSE";

  constructor(
    code:
      | "PAYLOAD_TOO_LARGE"
      | "INVALID_INPUT"
      | "CONSENT_REQUIRED"
      | "INVALID_MEASUREMENTS"
      | "UPSTREAM_RESPONSE_TOO_LARGE"
      | "INVALID_UPSTREAM_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "AiSecurityError";
    this.code = code;
  }
}

const measurementRanges: Record<string, [number, number]> = {
  height: [80, 250],
  weight: [20, 350],
  bust: [30, 250],
  waist: [30, 250],
  hip: [30, 250],
  footLength: [10, 40],
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseAiAssistantRequest(raw: string): AiAssistantInput {
  if (Buffer.byteLength(raw, "utf8") > 16_384) {
    throw new AiSecurityError("PAYLOAD_TOO_LARGE", "AI request payload is too large.");
  }
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw new AiSecurityError("INVALID_INPUT", "AI request must be valid JSON.");
  }
  if (!plainObject(source)) throw new AiSecurityError("INVALID_INPUT", "AI request must be an object.");
  if (source.privacyConsent !== true) {
    throw new AiSecurityError("CONSENT_REQUIRED", "Consent is required before sending a message to the AI provider.");
  }
  const message = typeof source.message === "string" ? source.message.trim() : "";
  if (!message || message.length > 800 || /\0/.test(message)) {
    throw new AiSecurityError("INVALID_INPUT", "Message must contain between 1 and 800 characters.");
  }
  const language = source.language === "en" ? "en" : source.language === "el" ? "el" : null;
  if (!language) throw new AiSecurityError("INVALID_INPUT", "Language must be English or Greek.");

  let measurements: AiMeasurements | undefined;
  if (source.measurements !== undefined) {
    if (!plainObject(source.measurements)) {
      throw new AiSecurityError("INVALID_MEASUREMENTS", "Measurements must be an object.");
    }
    const next: AiMeasurements = {};
    for (const [key, value] of Object.entries(source.measurements)) {
      if (key === "usualSize") {
        if (typeof value !== "string" || !value.trim() || value.trim().length > 32) {
          throw new AiSecurityError("INVALID_MEASUREMENTS", "Usual size is invalid.");
        }
        next.usualSize = value.trim();
        continue;
      }
      const range = measurementRanges[key];
      if (!range || typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
        throw new AiSecurityError("INVALID_MEASUREMENTS", `Measurement ${key} is invalid.`);
      }
      next[key as keyof AiMeasurements] = Math.round(value * 10) / 10;
    }
    if (Object.keys(next).length > 0) measurements = next;
  }

  const productSku = plainObject(source.productContext) && typeof source.productContext.sku === "string"
    ? source.productContext.sku.trim()
    : "";
  if (productSku.length > 120 || /[\u0000-\u001f]/.test(productSku)) {
    throw new AiSecurityError("INVALID_INPUT", "Product SKU is invalid.");
  }
  return { message, language, privacyConsent: true, measurements, productSku };
}

function boundedText(value: unknown, maximum: number, field: string, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", `${field} is required in AI JSON output.`);
    return "";
  }
  if (typeof value !== "string" || value.trim().length > maximum || (required && !value.trim())) {
    throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", `${field} is invalid in AI JSON output.`);
  }
  return value.trim();
}

export function parseAndConstrainAiModelOutput(raw: string, allowedSkus: ReadonlySet<string>): ConstrainedAiOutput {
  if (Buffer.byteLength(raw, "utf8") > 65_536) {
    throw new AiSecurityError("UPSTREAM_RESPONSE_TOO_LARGE", "AI provider response exceeded the maximum size.");
  }
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "AI provider response was not valid JSON.");
  }
  if (!plainObject(source)) throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "AI JSON output must be an object.");
  const reply = boundedText(source.reply, 1_200, "reply", true);
  const sizeAdvice = boundedText(source.sizeAdvice, 800, "sizeAdvice") || null;
  const recommendations = source.products === undefined ? [] : source.products;
  if (!Array.isArray(recommendations)) {
    throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "products must be an array in AI JSON output.");
  }
  const seen = new Set<string>();
  const products: Array<{ sku: string; reason: string }> = [];
  for (const recommendation of recommendations) {
    if (!plainObject(recommendation)) throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "AI product recommendation is invalid.");
    const sku = boundedText(recommendation.sku, 120, "sku", true);
    const reason = boundedText(recommendation.reason, 300, "reason");
    if (!allowedSkus.has(sku) || seen.has(sku)) continue;
    products.push({ sku, reason });
    seen.add(sku);
    if (products.length === 3) break;
  }
  return { reply, products, sizeAdvice };
}
