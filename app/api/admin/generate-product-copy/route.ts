import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import {
  AbuseProtectionUnavailableError,
  beginSharedAiRequest,
  finishSharedAiRequest,
} from "@/lib/abuse-protection";
import { AiSecurityError, readLimitedResponseText } from "@/lib/ai-security";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { ImageValidationError, optimizeImageFile, optimizeUploadedImage } from "@/lib/image-security";
import {
  MAX_PRODUCT_VISION_IMAGES,
  MAX_PRODUCT_VISION_OUTPUT_BYTES,
  MAX_PRODUCT_VISION_PAYLOAD_BYTES,
  ProductVisionError,
  buildOpenAiProductVisionBody,
  buildProductVisionPrompt,
  extractResponsesOutputText,
  parseProductVisionHints,
  parseProductVisionResult,
  type ProductVisionHints,
  type ProductVisionResult,
} from "@/lib/product-vision";
import { downloadRemoteImage } from "@/lib/secure-image-fetch";
import { configuredStorageOrigin } from "@/lib/storage-images";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const maxImageBytes = 10 * 1024 * 1024;
const maxImagePixels = 40_000_000;
const maxImageDimension = 12_000;
const maxRequestBytes = 25 * 1024 * 1024;

function cleanText(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function providerTimeoutMs() {
  const value = Number(process.env.PRODUCT_VISION_TIMEOUT_MS || process.env.AI_PROVIDER_TIMEOUT_MS || 30_000);
  if (!Number.isSafeInteger(value) || value < 5_000 || value > 60_000) {
    throw new AbuseProtectionUnavailableError("PRODUCT_VISION_TIMEOUT_MS is outside its safe range.");
  }
  return value;
}

function imageOrigins() {
  const storageOrigin = configuredStorageOrigin();
  const explicit = String(process.env.SERVER_IMAGE_FETCH_ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return {
    storageOrigin,
    allowedOrigins: Array.from(new Set([storageOrigin, ...explicit].filter(Boolean))),
  };
}

function imageUrlList(value: unknown) {
  if (Array.isArray(value)) return value.map(item => cleanText(item, 2_000)).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(item => cleanText(item, 2_000)).filter(Boolean);
  } catch {
    // Legacy text is split below. It is never trusted as an unrestricted fetch target.
  }
  return trimmed.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}

async function normalizeLocalImage(file: File) {
  const image = await optimizeImageFile(file, {
    maxBytes: maxImageBytes,
    maxPixels: maxImagePixels,
    maxWidth: maxImageDimension,
    maxHeight: maxImageDimension,
    resize: { width: 1_600, height: 1_600, fit: "inside" },
    quality: 85,
  });
  return image.buffer;
}

async function normalizeStoredImage(url: string) {
  const { storageOrigin, allowedOrigins } = imageOrigins();
  if (allowedOrigins.length === 0) throw new Error("Customer Storage origin is not configured.");
  const downloaded = await downloadRemoteImage(url, {
    allowedOrigins,
    storageOrigin: storageOrigin || undefined,
    maxBytes: maxImageBytes,
    timeoutMs: 20_000,
    maxRedirects: 3,
  });
  const image = await optimizeUploadedImage(downloaded.buffer, {
    declaredMimeType: downloaded.contentType,
    maxBytes: maxImageBytes,
    maxPixels: maxImagePixels,
    maxWidth: maxImageDimension,
    maxHeight: maxImageDimension,
    resize: { width: 1_600, height: 1_600, fit: "inside" },
    quality: 85,
  });
  return image.buffer;
}

async function storedImagesForProduct(hints: ProductVisionHints) {
  if (!hints.use_stored_images) return [];
  if (!hints.sku) throw new ProductVisionError("INVALID_INPUT", "读取已保存图片时必须提供商品 SKU。");
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new AbuseProtectionUnavailableError("Server-side Supabase is unavailable.");
  const { data, error } = await (supabase as any)
    .from("products")
    .select("sku, image_url, image_urls")
    .eq("sku", hints.sku)
    .maybeSingle();
  if (error) throw new AbuseProtectionUnavailableError("商品图片读取失败。");
  if (!data) throw new ProductVisionError("INVALID_INPUT", "未找到需要识别的商品。");
  const urls = Array.from(new Set([
    cleanText(data.image_url, 2_000),
    ...imageUrlList(data.image_urls),
  ].filter(Boolean))).slice(0, MAX_PRODUCT_VISION_IMAGES);
  return Promise.all(urls.map(normalizeStoredImage));
}

async function parseRequest(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    throw new ProductVisionError("INVALID_INPUT", "图片请求超过 25 MB 限制。");
  }
  const contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const formData = await request.formData();
    const productJson = formData.get("product");
    if (typeof productJson !== "string" || Buffer.byteLength(productJson, "utf8") > MAX_PRODUCT_VISION_PAYLOAD_BYTES) {
      throw new ProductVisionError("INVALID_INPUT", "商品资料为空或超过安全限制。");
    }
    let rawProduct: unknown;
    try {
      rawProduct = JSON.parse(productJson);
    } catch {
      throw new ProductVisionError("INVALID_INPUT", "商品资料不是有效 JSON。");
    }
    const files = formData.getAll("images").filter((entry): entry is File => entry instanceof File);
    if (files.length > MAX_PRODUCT_VISION_IMAGES) {
      throw new ProductVisionError("INVALID_INPUT", `每次最多识别 ${MAX_PRODUCT_VISION_IMAGES} 张图片。`);
    }
    return { hints: parseProductVisionHints(rawProduct), files };
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_PRODUCT_VISION_PAYLOAD_BYTES) {
    throw new ProductVisionError("INVALID_INPUT", "商品资料超过安全限制。");
  }
  let body: unknown;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    throw new ProductVisionError("INVALID_INPUT", "请求不是有效 JSON。");
  }
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  return { hints: parseProductVisionHints(source.product), files: [] as File[] };
}

function hasTextHints(hints: ProductVisionHints) {
  return Boolean(hints.category || hints.subcategory || hints.name_cn || hints.description_cn || hints.notes);
}

function stringList(value: unknown, limit: number) {
  if (Array.isArray(value)) return value.map(item => cleanText(item, 40)).filter(Boolean).slice(0, limit);
  return cleanText(value, 240).split(",").map(item => item.trim()).filter(Boolean).slice(0, limit);
}

function parseTextCopyResult(raw: string, hints: ProductVisionHints) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 未返回有效的商品资料。");
  }
  return parseProductVisionResult({
    name_cn: data.name_cn,
    description_cn: data.description_cn,
    name_en: data.name_en,
    description_en: data.description_en,
    name_gr: data.name_gr,
    description_gr: data.description_gr,
    fit_type: data.fit_type,
    material: hints.material,
    material_evidence: hints.material ? "owner_provided" : "unknown",
    ai_keywords: stringList(data.ai_keywords, 8),
    style_tags: stringList(data.style_tags, 5),
    visual_summary: "",
  });
}

async function callOpenAiVision(prompt: string, images: Buffer[]) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new AbuseProtectionUnavailableError("OPENAI_API_KEY is not configured.");
  const model = String(process.env.OPENAI_PRODUCT_VISION_MODEL || "gpt-5.6-luna").trim() || "gpt-5.6-luna";
  const imageDataUrls = images.map(buffer => `data:image/webp;base64,${buffer.toString("base64")}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildOpenAiProductVisionBody({ model, prompt, imageDataUrls })),
    });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await readLimitedResponseText(response, MAX_PRODUCT_VISION_OUTPUT_BYTES);
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "OpenAI 返回内容无法解析。");
  }
  if (!response.ok) {
    const message = cleanText((envelope as { error?: { message?: unknown } })?.error?.message, 240);
    throw new Error(message ? `OpenAI 图片识别失败：${message}` : `OpenAI 图片识别失败（HTTP ${response.status}）。`);
  }
  return parseProductVisionResult(extractResponsesOutputText(envelope));
}

async function callDeepSeekText(prompt: string, hints: ProductVisionHints) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) throw new AbuseProtectionUnavailableError("DEEPSEEK_API_KEY is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.DEEPSEEK_TRANSLATION_MODEL || "deepseek-chat",
        temperature: 0.4,
        max_tokens: 1_200,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `${prompt}\nReturn only JSON with name_cn, description_cn, name_en, description_en, name_gr, description_gr, fit_type, ai_keywords, and style_tags.`,
        }],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  const raw = await readLimitedResponseText(response, MAX_PRODUCT_VISION_OUTPUT_BYTES);
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 返回内容无法解析。");
  }
  if (!response.ok) throw new Error(`AI 文案生成失败（HTTP ${response.status}）。`);
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ProductVisionError("INVALID_UPSTREAM_RESPONSE", "AI 未返回商品资料。");
  return parseTextCopyResult(content, hints);
}

function responsePayload(result: ProductVisionResult, imagesAnalyzed: number) {
  return {
    ...result,
    ai_keywords: result.ai_keywords.join(", "),
    style_tags: result.style_tags.join(", "),
    images_analyzed: imagesAnalyzed,
    generation_mode: imagesAnalyzed > 0 ? "vision" : "text",
  };
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "ai:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  let hints: ProductVisionHints;
  let images: Buffer[];
  try {
    const parsed = await parseRequest(request);
    hints = parsed.hints;
    images = await Promise.all(parsed.files.map(normalizeLocalImage));
    if (images.length === 0 && hints.use_stored_images) images = await storedImagesForProduct(hints);
    if (images.length === 0 && !hasTextHints(hints)) {
      return NextResponse.json({ error: "请先上传商品照片，或填写分类、商品名或备注。", code: "INVALID_INPUT" }, { status: 400 });
    }
  } catch (error) {
    const status = error instanceof ImageValidationError && error.code === "FILE_TOO_LARGE" ? 413
      : error instanceof AbuseProtectionUnavailableError ? 503
        : 400;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "商品图片或资料无效。",
      code: error instanceof ImageValidationError ? error.code
        : error instanceof ProductVisionError ? error.code
          : status === 503 ? "AI_SECURITY_UNAVAILABLE" : "INVALID_INPUT",
    }, { status });
  }

  const prompt = buildProductVisionPrompt(hints, images.length);
  const requestId = randomUUID();
  let leaseStarted = false;
  let leaseFinished = false;
  let outputCharacters = 0;
  try {
    const limit = await beginSharedAiRequest({
      request,
      requestId,
      sessionId: adminActorFromContext(authorization.context),
      inputCharacters: prompt.length + images.length * 4_000,
    });
    if (!limit.allowed) {
      return NextResponse.json({
        error: "AI 使用次数已达到临时限制，请稍后再试。",
        code: limit.code,
        retryAfter: limit.retryAfter,
      }, { status: 429, headers: { "Retry-After": String(limit.retryAfter || 1) } });
    }
    leaseStarted = true;
    const generated = images.length > 0
      ? await callOpenAiVision(prompt, images)
      : await callDeepSeekText(prompt, hints);
    const result: ProductVisionResult = hints.material
      ? { ...generated, material: hints.material, material_evidence: "owner_provided" }
      : generated;
    outputCharacters = JSON.stringify(result).length;
    await finishSharedAiRequest(requestId, "completed", outputCharacters);
    leaseFinished = true;
    return NextResponse.json(responsePayload(result, images.length));
  } catch (error) {
    if (leaseStarted && !leaseFinished) {
      try {
        await finishSharedAiRequest(requestId, "failed", outputCharacters);
      } catch {
        return NextResponse.json({ error: "AI 安全计费状态无法确认，请稍后重试。", code: "AI_SECURITY_UNAVAILABLE" }, { status: 503 });
      }
    }
    const timeout = error instanceof Error && error.name === "AbortError";
    const securityUnavailable = error instanceof AbuseProtectionUnavailableError;
    const invalidResponse = error instanceof ProductVisionError || error instanceof AiSecurityError;
    return NextResponse.json({
      error: timeout ? "AI 图片识别超时，请稍后重试。"
        : securityUnavailable ? "AI 服务配置未完成或安全保护不可用。"
          : error instanceof Error ? error.message : "AI 商品资料生成失败。",
      code: timeout ? "AI_PROVIDER_TIMEOUT"
        : securityUnavailable ? "AI_SECURITY_UNAVAILABLE"
          : invalidResponse ? "AI_PROVIDER_INVALID_RESPONSE" : "AI_PROVIDER_FAILED",
    }, { status: timeout ? 504 : securityUnavailable ? 503 : 502 });
  }
}
