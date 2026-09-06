import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { AI_PRODUCT_SELECT } from "@/lib/product-data-boundary";
import { getBusinessSettings } from "@/lib/settings";
import { isFeatureEnabled } from "@/lib/features";
import { randomUUID } from "node:crypto";
import {
  AiSecurityError,
  createBoundedAiCustomerPayload,
  parseAiAssistantRequest,
  parseAndConstrainAiModelOutput,
  readLimitedResponseText,
} from "@/lib/ai-security";
import {
  AbuseProtectionUnavailableError,
  beginSharedAiRequest,
  finishSharedAiRequest,
} from "@/lib/abuse-protection";
import { publicVariantOptions } from "@/lib/product-variant-matrix";

const SYSTEM_PROMPT = `You are a customer-facing shopping assistant for a clothing store in Greece.

CRITICAL LANGUAGE RULES:
- NEVER reply in Chinese to customers. This is a Greek store.
- If the customer writes in English, reply in English.
- If the customer writes in Greek, reply in Greek.
- If the customer writes in Chinese, do NOT reply in Chinese. Reply in the storefront language and politely explain that you can only assist in English or Greek.
- If the customer mixes English and Greek, reply in whichever language dominates their latest message. If tied, use the current storefront language.
- Chinese product fields (name_cn, description_cn) are internal admin references. NEVER show them to customers.
- If a product has only Chinese text and no English/Greek translation, use category, price, size, image, and other non-Chinese fields to describe it, or say the product information is being updated.

RULES:
- Only recommend products that are in the ACTUAL_PRODUCTS list sent with each message.
- Never invent product names, prices, stock, discounts, sizes, or product details.
- If no matching products exist, say so politely and suggest browsing categories.
- For size recommendations, use the MEASUREMENTS and SIZE_CHART data.
- Treat SIZE_SYSTEM, AVAILABLE_SIZES, SOLD_OUT_SIZES, and SIZE_CHART as structured store data, not suggestions.
- If measurements are incomplete, ask for the missing fields: height, weight, bust, waist, hip.
- Size advice should sound like a helpful human store assistant, not an absolute guarantee.
- For size advice, give the most likely size first, then one relaxed/slim alternative only if useful.
- If no detailed size chart exists, clearly say the advice is approximate and ask for bust/shoulder/waist/hip measurements for better accuracy when relevant.
- If a likely size is not available, mention the current available-size limitation and suggest the closest available option carefully.
- Do NOT discuss politics, health advice, or topics unrelated to this store.
- For shipping, returns, payment, pickup, and store-policy questions: only answer from STORE_INFO if it is explicitly provided. If STORE_INFO does not contain the answer, say the store team should confirm it on WhatsApp.
- If asked about prices, all prices are in EUR and include VAT.
- Never promise discounts, delivery dates, exact stock, returns approval, or payment availability unless that exact information is present in STORE_INFO or ACTUAL_PRODUCTS.
- Stock and size availability must come from ACTUAL_PRODUCTS / CURRENT_PRODUCT only. If uncertain, say it should be confirmed with the store before purchase.
- Do not claim that an item is reserved, purchased, shipped, or held for the customer. The website is a browsing and inquiry channel, not a confirmed checkout system.
- If the customer asks to buy, reserve, pay, or place an order, explain that the store team should confirm the item, size, and availability before any purchase.

OUTPUT LENGTH LIMITS:
- Keep replies to 2-5 sentences maximum.
- Recommend at most 3 products per response.
- For size advice, recommend 1 primary size plus at most 1 relaxed/slim alternative, and avoid absolute certainty.

MATERIAL FIELD:
- The material field may contain internal admin notes.
- Each product also has material_verified (true/false).
- If material_verified is TRUE, you may tell customers the material and translate it to English/Greek as needed.
- If material_verified is FALSE, do NOT tell customers the material as fact. Say:
  EN: "The material information has not been confirmed yet. Please contact us on WhatsApp for details."
  EL: "Οι πληροφορίες για το υλικό δεν έχουν επιβεβαιωθεί ακόμη. Παρακαλούμε επικοινωνήστε μαζί μας στο WhatsApp για λεπτομέρειες."
- Common material translations when material_verified is true: cotton=βαμβάκι, polyester=πολυεστέρας, silk=μετάξι, denim=τζιν, wool=μαλλί, linen=λινό, leather=δέρμα.

PRODUCT NAMES:
- When showing product names to English-speaking customers, use name_en.
- When showing product names to Greek-speaking customers, use name_gr.
- Never show name_cn to customers.

RESPONSE FORMAT (JSON):
{
  "reply": "friendly text response in English or Greek only",
  "products": [{ "sku": "abc-001", "reason": "why recommended" }],
  "sizeAdvice": "size recommendation text"
}

SIZE RECOMMENDATION RULES BY DATA AVAILABILITY:

SIZE SYSTEM DEFINITIONS:
- letter: letter sizing such as XS, S, M, L, XL. Do not convert it to an EU number unless this product's SIZE_CHART explicitly provides that mapping.
- eu_women_numeric: European women's numeric labels, currently supported as EU 32-54. Treat each value as the exact label stored for this product; the same EU number can fit differently by brand and cut.
- eu_men_numeric: European men's numeric labels, currently supported as EU 42-64. Treat each value as the exact label stored for this product; do not map it to S/M/L without an explicit product SIZE_CHART.
- eu_shoes: European shoe labels, currently supported as EU 35-48. Ask for foot length in centimetres and use only an explicit product SIZE_CHART for a recommendation. Do not guess a conversion from UK, US, or letter sizing.
- one_size: the product has one selectable size. Explain that One Size is not a universal fit and use product measurements or SIZE_CHART when available.
- custom: use the stored size labels exactly as written and do not infer a standard conversion.

STOCK AND LABEL RULES:
- AVAILABLE_SIZES contains the only sizes that may be described as currently available.
- SOLD_OUT_SIZES may be mentioned as sold out, but never recommended as available.
- ALL_SIZES is the complete known label list. Do not invent a label outside it.
- A size with quantity 0 is sold out even if it appears in the old sizes text.
- Never silently convert between EU numeric, letter, shoe, One Size, or custom systems.
- When VARIANTS or AVAILABLE_SIZES_BY_COLOR are present, availability is specific to the exact color and size combination. Never claim that a size is available in every color.
- If the customer names a color, use only that color's Variant rows. A quantity of 0 for that color/size combination means sold out even when the same size is available in another color.
- If a product has one or no named color, do not invent a color choice.
- If the customer asks for a conversion and this product has no explicit mapping in SIZE_CHART, say that sizing varies by brand and ask for measurements or recommend trying it in store.

PRIORITY 1: size_chart exists on CURRENT_PRODUCT
- Compare customer measurements against the size_chart and recommend the closest size.
- Always mention AVAILABLE_SIZES, not sold-out size labels.
- Say: "Based on the size chart for this [product name], size [X] looks like the best starting point."
- If the customer seems between sizes, mention the nearest alternative for a looser or slimmer fit.

PRIORITY 2: no size_chart, but available_sizes exist
- Always mention AVAILABLE_SIZES first.
- For letter-sized clothing only, you may make a cautious approximate recommendation from height, weight, measurements, fit_type, and category.
- For EU numeric clothing, use an exact product SIZE_CHART when possible. Without one, do not claim that height/weight alone maps reliably to an EU number; ask for bust/waist/hip measurements and make clear that the store should confirm the fit.
- Add one sentence saying this is approximate because this product does not have a detailed size chart yet.
- For shoes, if no foot_length is provided, ask for foot length in cm; without an explicit chart, do not claim an exact EU shoe size.
- If SIZE_SYSTEM is one_size, say the product is One Size. Do not assume every bag, hat, jewelry item, luggage item, or accessory is One Size unless its stored SIZE_SYSTEM or ALL_SIZES says so.

PRIORITY 3: no sizes at all
- Say size information is not available yet and suggest contacting the store on WhatsApp or visiting in store.

WHEN CURRENT_PRODUCT IS PROVIDED:
- Always start with "For this [product name]..." and mention the specific product.
- Never say "most tops" or "bottoms"; talk about the specific product only.

WHATSAPP MENTION:
- The chat panel already has a WhatsApp contact footer. Do NOT repeat WhatsApp in your reply unless the user explicitly asks how to contact the store.
- Keep the size disclaimer short and WhatsApp-free: "This is only a size recommendation. For the most accurate fit, try it in store."`;

const sizeSystemLabels: Record<string, string> = {
  letter: "Letter sizing (XS-XXXL as stored)",
  eu_women_numeric: "European women's numeric sizing (EU 32-54)",
  eu_men_numeric: "European men's numeric sizing (EU 42-64)",
  eu_shoes: "European shoe sizing (EU 35-48)",
  one_size: "One Size",
  custom: "Custom store labels",
};

function cleanSizeSystem(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized in sizeSystemLabels ? normalized : "unspecified";
}

function cleanSizeStock(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([label, quantity]) => [label.trim(), Math.max(0, Math.trunc(Number(quantity) || 0))] as const)
      .filter(([label]) => Boolean(label)),
  );
}

function legacySizeLabels(value: unknown) {
  return Array.from(new Set(
    String(value || "")
      .split(/[,;|\n]+/)
      .map((label) => label.trim())
      .filter(Boolean),
  ));
}

function buildProductSummary(products: Record<string, unknown>[]) {
  return products.map((p) => {
    const sizeSystem = cleanSizeSystem(p.size_system);
    const sizeStock = cleanSizeStock(p.size_stock);
    const stockEntries = Object.entries(sizeStock);
    const fallbackSizes = legacySizeLabels(p.sizes);
    const allSizes = stockEntries.length > 0 ? stockEntries.map(([label]) => label) : fallbackSizes;
    const availableSizes = stockEntries.length > 0
      ? stockEntries.filter(([, quantity]) => quantity > 0).map(([label]) => label)
      : Number(p.stock) > 0 ? fallbackSizes : [];
    const soldOutSizes = stockEntries.length > 0
      ? stockEntries.filter(([, quantity]) => quantity <= 0).map(([label]) => label)
      : Number(p.stock) <= 0 ? fallbackSizes : [];
    const variants = publicVariantOptions(p.variants);
    const colors = Array.from(new Set(variants.map(variant => variant.color).filter(Boolean)));
    const availableByColor = Object.fromEntries(colors.map(color => [
      color,
      variants
        .filter(variant => variant.color.toLocaleLowerCase() === color.toLocaleLowerCase() && variant.quantityAvailable > 0)
        .map(variant => variant.size),
    ]));

    return {
      sku: p.sku,
      name_en: p.name_en || "",
      name_gr: p.name_gr || "",
      category: p.category || "",
      subcategory: p.subcategory || "",
      price: Number(p.price),
      stock: Number(p.stock),
      sizes: p.sizes || "",
      size_system: sizeSystem,
      size_system_description: sizeSystemLabels[sizeSystem] || "Unspecified; use stored labels exactly",
      all_sizes: allSizes,
      available_sizes: availableSizes,
      sold_out_sizes: soldOutSizes,
      size_stock: sizeStock,
      colors,
      variants: variants.map(variant => ({
        size: variant.size,
        color: variant.color,
        quantity_available: variant.quantityAvailable,
      })),
      available_sizes_by_color: availableByColor,
      size_chart: p.size_chart || {},
      fit_type: p.fit_type || "regular",
      material: p.material || "",
      material_verified: Boolean(p.material_verified),
      brand: p.brand || "",
      color: p.color || "",
      style_tags: p.ai_keywords || [],
      image_url: p.image_url || "",
    };
  });
}

const aiSessionCookieName = "clothing_ai_session";
const aiSessionLifetimeSeconds = 24 * 60 * 60;

function aiSessionId(request: NextRequest) {
  const existing = request.cookies.get(aiSessionCookieName)?.value || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
    ? existing
    : randomUUID();
}

function withAiSession(response: NextResponse, sessionId: string) {
  response.cookies.set(aiSessionCookieName, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/ai-shop-assistant",
    maxAge: aiSessionLifetimeSeconds,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function localizedUnavailable(language: "en" | "el") {
  return language === "el"
    ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλούμε δοκιμάστε ξανά αργότερα."
    : "AI assistant is temporarily unavailable. Please try again later.";
}

class AiProviderError extends Error {
  readonly code: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT";

  constructor(code: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT") {
    super(code);
    this.code = code;
  }
}

function aiProviderUrl() {
  const testUrl = String(process.env.AI_TEST_PROVIDER_URL || "").trim();
  if (!testUrl) return "https://api.deepseek.com/v1/chat/completions";
  const parsed = new URL(testUrl);
  if (
    process.env.AI_TEST_MODE !== "true"
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !["http:", "https:"].includes(parsed.protocol)
  ) throw new AbuseProtectionUnavailableError("AI_TEST_PROVIDER_URL is allowed only for an explicit loopback test environment.");
  return parsed.toString();
}

function aiProviderTimeoutMs() {
  const value = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 15_000);
  if (!Number.isInteger(value) || value < 1_000 || value > 30_000) {
    throw new AbuseProtectionUnavailableError("AI_PROVIDER_TIMEOUT_MS is outside its safe range.");
  }
  return value;
}

const localReplies: Record<string, Record<string, string>> = {
  en: {
    hello: "Hello! I'm your shopping assistant. How can I help you today?",
    hi: "Hi there! Looking for something specific, or need a size recommendation?",
    hey: "Hey! I can help you find products or recommend sizes. What are you looking for?",
    "can you speak chinese": "I'm sorry, I can only assist in English or Greek. How can I help you?",
    "do you speak chinese": "I'm sorry, I can only assist in English or Greek. How can I help you?",
    "what is your store name": "This is an AI assistant for our fashion boutique. You can find our store name at the top of the page or in the store info section.",
    "store name": "Our store name is shown at the top of the website. You can also find it on Google Maps and social media.",
    contact: "You can contact us via WhatsApp using the button on this page, or visit our store in Athens.",
    whatsapp: "You can reach us on WhatsApp! Click the WhatsApp button on the product page or use the link in the footer.",
  },
  el: {
    hello: "Γεια σας! Είμαι ο βοηθός αγορών σας. Πώς μπορώ να σας βοηθήσω σήμερα;",
    hi: "Γεια σας! Ψάχνετε κάτι συγκεκριμένο ή χρειάζεστε βοήθεια με το μέγεθος;",
    hey: "Γεια σας! Μπορώ να σας βοηθήσω να βρείτε προϊόντα ή να προτείνω μέγεθος. Τι ψάχνετε;",
    "can you speak chinese": "Λυπάμαι, μπορώ να βοηθήσω μόνο στα Αγγλικά ή στα Ελληνικά. Πώς μπορώ να σας βοηθήσω;",
    "do you speak chinese": "Λυπάμαι, μπορώ να βοηθήσω μόνο στα Αγγλικά ή στα Ελληνικά. Πώς μπορώ να σας βοηθήσω;",
    "what is your store name": "Το όνομα του καταστήματος εμφανίζεται στην κορυφή της ιστοσελίδας.",
    "store name": "Το όνομα του καταστήματός μας εμφανίζεται στην κορυφή της ιστοσελίδας.",
    contact: "Μπορείτε να επικοινωνήσετε μαζί μας μέσω WhatsApp ή να επισκεφθείτε το κατάστημά μας στην Αθήνα.",
    whatsapp: "Μπορείτε να μας στείλετε μήνυμα στο WhatsApp από το κουμπί της σελίδας προϊόντος ή από το footer.",
  },
};

function getLocalReply(message: string, lang: string): string | null {
  const key = message.toLowerCase().replace(/[!?.,]/g, "").trim();
  const replies = localReplies[lang] || localReplies.en;
  if (replies[key]) return replies[key];

  for (const [k, v] of Object.entries(replies)) {
    if (key.includes(k) || k.includes(key)) return v;
  }

  return null;
}

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled("ai_tools"))) {
    return NextResponse.json({ error: "AI assistant is not enabled.", code: "FEATURE_DISABLED" }, { status: 403 });
  }
  const sessionId = aiSessionId(request);
  let input;
  try {
    input = parseAiAssistantRequest(await request.text());
  } catch (error) {
    const securityError = error instanceof AiSecurityError ? error : null;
    const status = securityError?.code === "PAYLOAD_TOO_LARGE" ? 413
      : securityError?.code === "CONSENT_REQUIRED" ? 403
        : 400;
    return withAiSession(NextResponse.json({
      error: securityError?.message || "AI request is invalid.",
      code: securityError?.code || "INVALID_INPUT",
    }, { status }), sessionId);
  }
  const { message, language, measurements, productSku: requestedProductSku } = input;

  const localReply = getLocalReply(message, language);
  if (localReply) {
    return withAiSession(NextResponse.json({ reply: localReply, products: [] }), sessionId);
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return withAiSession(NextResponse.json({
      reply: localizedUnavailable(language),
      code: "AI_PROVIDER_UNAVAILABLE",
    }, { status: 503 }), sessionId);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return withAiSession(NextResponse.json({ reply: localizedUnavailable(language), code: "AI_DATA_UNAVAILABLE" }, { status: 503 }), sessionId);
  }
  const { data, error: productsError } = await (supabase as any)
    .from("products")
    .select(AI_PRODUCT_SELECT)
    .neq("is_active", false)
    .gte("stock", 0)
    .order("created_at", { ascending: false })
    .limit(20);
  if (productsError) {
    return withAiSession(NextResponse.json({ reply: localizedUnavailable(language), code: "AI_DATA_UNAVAILABLE" }, { status: 503 }), sessionId);
  }

  let allProducts = (data || []) as Record<string, unknown>[];
  let currentProduct = requestedProductSku
    ? allProducts.find((product) => String(product.sku || "") === requestedProductSku) || null
    : null;

  // Product context from the browser is only a SKU hint. Reload the authoritative
  // product record so customer-edited request data cannot invent sizes or stock.
  if (requestedProductSku && !currentProduct) {
    const { data: requestedProduct, error: requestedProductError } = await (supabase as any)
      .from("products")
      .select(AI_PRODUCT_SELECT)
      .eq("sku", requestedProductSku)
      .neq("is_active", false)
      .maybeSingle();
    if (requestedProductError) {
      return withAiSession(NextResponse.json({ reply: localizedUnavailable(language), code: "AI_DATA_UNAVAILABLE" }, { status: 503 }), sessionId);
    }
    currentProduct = requestedProduct as Record<string, unknown> | null;
    if (currentProduct) allProducts = [currentProduct, ...allProducts];
  }

  const productSkus = Array.from(new Set(allProducts.map(product => String(product.sku || "").trim()).filter(Boolean))).slice(0, 20);
  const { data: variantsBySku, error: variantsError } = await (supabase as any).rpc(
    "product_public_variants_batch_rpc",
    { p_product_skus: productSkus },
  );
  if (variantsError || !variantsBySku || typeof variantsBySku !== "object" || Array.isArray(variantsBySku)) {
    return withAiSession(NextResponse.json({ reply: localizedUnavailable(language), code: "AI_DATA_UNAVAILABLE" }, { status: 503 }), sessionId);
  }
  const variantMap = variantsBySku as Record<string, unknown>;
  allProducts = allProducts.map(product => ({
    ...product,
    variants: publicVariantOptions(variantMap[String(product.sku || "")]),
  }));
  currentProduct = requestedProductSku
    ? allProducts.find(product => String(product.sku || "") === requestedProductSku) || null
    : null;

  const productSummary = buildProductSummary(allProducts);
  const currentProductSummary = currentProduct ? buildProductSummary([currentProduct])[0] : undefined;

  const settings = await getBusinessSettings();
  const storeName = settings.business_name || "Online Store";
  const langPrompt = language === "el"
    ? 'Reply in Greek. Greet naturally with "Γεια σας".'
    : "Reply in English. Greet naturally.";

  const storeInfo = {
    storeName,
    address: settings.address || "",
    opening_hours: settings.opening_hours || "",
    online_ordering: settings.online_store_enabled ? "available" : "unavailable",
    viva_online_payment: settings.online_store_enabled && settings.viva_payments_enabled ? "available" : "unavailable",
    box_now_locker: settings.online_store_enabled && settings.viva_payments_enabled && settings.boxnow_enabled ? "available" : "unavailable",
    store_pickup: settings.online_store_enabled && settings.viva_payments_enabled && settings.pickup_enabled ? "available" : "unavailable",
    boxnow_minimum_subtotal_eur: settings.boxnow_enabled ? settings.boxnow_minimum_subtotal : null,
    boxnow_shipping_fee_eur: settings.boxnow_enabled ? settings.boxnow_shipping_fee : null,
    boxnow_free_shipping_threshold_eur: settings.boxnow_enabled ? settings.boxnow_free_shipping_threshold : null,
    boxnow_instructions: language === "en" ? "Choose an available BOX NOW Locker during checkout." : "Επιλέξτε διαθέσιμο BOX NOW Locker κατά την ολοκλήρωση της παραγγελίας.",
    pickup_instructions: language === "en" ? settings.pickup_instructions_en : settings.pickup_instructions_gr,
    whatsapp: settings.whatsapp ? "available" : "",
    instagram: settings.instagram || "",
    footer_text: settings.footer_text || "",
  };
  const context = `${SYSTEM_PROMPT}\n${langPrompt}\nStore: ${storeName}\nSTORE_INFO: ${JSON.stringify(storeInfo)}`;

  const requestId = randomUUID();
  let boundedPayload;
  try {
    boundedPayload = createBoundedAiCustomerPayload({
      message,
      language,
      measurements,
      currentProduct: currentProductSummary,
      products: productSummary,
    });
  } catch (error) {
    const securityError = error instanceof AiSecurityError ? error : null;
    return withAiSession(NextResponse.json({
      reply: localizedUnavailable(language),
      code: securityError?.code || "AI_SECURITY_UNAVAILABLE",
      products: [],
    }, { status: securityError?.code === "PAYLOAD_TOO_LARGE" ? 413 : 503 }), sessionId);
  }
  const customerPayload = boundedPayload.payload;
  let leaseStarted = false;
  let leaseFinished = false;
  let outputCharacters = 0;
  try {
    const limit = await beginSharedAiRequest({
      request,
      requestId,
      sessionId,
      inputCharacters: customerPayload.length,
    });
    if (!limit.allowed) {
      return withAiSession(NextResponse.json({
        reply: language === "el"
          ? "Έχει επιτευχθεί προσωρινά το όριο χρήσης του AI. Παρακαλούμε δοκιμάστε ξανά αργότερα."
          : "The AI usage limit has been reached temporarily. Please try again later.",
        code: limit.code,
        retryAfter: limit.retryAfter,
        products: [],
      }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfter || 1) },
      }), sessionId);
    }
    leaseStarted = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiProviderTimeoutMs());
    let response: Response;
    try {
      response = await fetch(aiProviderUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: context },
            { role: "user", content: customerPayload },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("AI_PROVIDER_TIMEOUT");
      throw new AiProviderError("AI_PROVIDER_FAILED");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new AiProviderError("AI_PROVIDER_FAILED");

    const rawProviderResponse = await readLimitedResponseText(response);
    outputCharacters = rawProviderResponse.length;
    let providerEnvelope: unknown;
    try {
      providerEnvelope = JSON.parse(rawProviderResponse);
    } catch {
      throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "AI provider response envelope was not valid JSON.");
    }
    const content = (providerEnvelope as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new AiSecurityError("INVALID_UPSTREAM_RESPONSE", "AI provider response omitted JSON content.");
    }
    const parsed = parseAndConstrainAiModelOutput(content, boundedPayload.allowedSkus);

    const enriched = parsed.products
      .map((recommendation) => {
        const product = allProducts.find((candidate) => candidate.sku === recommendation.sku);
        return product ? {
          ...buildProductSummary([product])[0],
          reason: recommendation.reason,
          url: `/product/${encodeURIComponent(recommendation.sku)}`,
        } : null;
      })
      .filter(Boolean);

    await finishSharedAiRequest(requestId, "completed", outputCharacters);
    leaseFinished = true;
    return withAiSession(NextResponse.json({
      reply: parsed.reply,
      products: enriched,
      sizeAdvice: parsed.sizeAdvice,
    }), sessionId);
  } catch (error) {
    if (leaseStarted && !leaseFinished) {
      try {
        await finishSharedAiRequest(requestId, "failed", outputCharacters);
      } catch {
        return withAiSession(NextResponse.json({
          reply: localizedUnavailable(language),
          code: "AI_SECURITY_UNAVAILABLE",
          products: [],
        }, { status: 503 }), sessionId);
      }
    }
    const timeout = error instanceof AiProviderError && error.code === "AI_PROVIDER_TIMEOUT";
    const upstream = error instanceof AiProviderError || error instanceof AiSecurityError;
    const unavailable = error instanceof AbuseProtectionUnavailableError;
    return withAiSession(NextResponse.json({
      reply: localizedUnavailable(language),
      code: timeout ? "AI_PROVIDER_TIMEOUT"
        : unavailable ? "AI_SECURITY_UNAVAILABLE"
          : upstream ? "AI_PROVIDER_INVALID_RESPONSE"
            : "AI_PROVIDER_FAILED",
      products: [],
    }, { status: timeout ? 504 : unavailable ? 503 : 502 }), sessionId);
  }
}
