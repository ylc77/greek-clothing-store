import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getBusinessSettings } from "@/lib/settings";

const SYSTEM_PROMPT = `You are a customer-facing shopping assistant for a clothing store in Greece. Your ONLY job is to help customers find real products from the store's inventory.

LANGUAGE RULES:
- Never reply in Chinese to customers. Chinese product fields (name_cn, description_cn) are internal references only — do NOT show them to customers.
- Reply in the same language as the customer's latest message when it is English or Greek.
- If the customer's message is mixed or unclear, default to Greek (the store's primary language).
- Only use English or Greek in customer-facing responses.

RULES:
- Only recommend products that are in the ACTUAL_PRODUCTS list sent with each message.
- Never invent product names, prices, stock, discounts, sizes, or any product details.
- If no matching products exist, say so politely and suggest browsing categories.
- For size recommendations, use the MEASUREMENTS and SIZE_CHART data.
- If measurements are incomplete, ask for the missing fields (height, weight, bust, waist, hip).
- Always add: "Size recommendation is a reference only. Visit our store to try on."
- Greet in English or Greek based on the user's language.
- Keep responses concise (2-4 sentences + product cards when relevant).
- Do NOT discuss: politics, health advice, delivery shipping, returns policy, payments, or anything not about this store's products.
- If asked about prices: all prices are in EUR and include VAT.

PRODUCT NAMES:
- When showing product names to English-speaking customers, use name_en.
- When showing product names to Greek-speaking customers, use name_gr.
- Never show name_cn to customers.

RESPONSE FORMAT (JSON):
{
  "reply": "friendly text response in English or Greek only",
  "products": [{ "sku": "abc-001", "reason": "why recommended" }],
  "sizeAdvice": "size recommendation text"
}`;

function buildProductSummary(products: Record<string, unknown>[]) {
  return products.map(p => ({
    sku: p.sku,
    name_en: p.name_en || "",
    name_gr: p.name_gr || "",
    category: p.category || "",
    subcategory: p.subcategory || "",
    price: Number(p.price),
    stock: Number(p.stock),
    sizes: p.sizes || "",
    size_stock: p.size_stock || {},
    size_chart: p.size_chart || {},
    fit_type: p.fit_type || "regular",
    material: p.material || "",
    brand: p.brand || "",
    color: p.color || "",
    style_tags: p.ai_keywords || [],
    image_url: p.image_url || "",
  }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const language = body.language === "en" ? "en" : "el";
  const measurements = body.measurements || {};

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({ reply: "AI assistant is not configured." });
  }

  // Fetch active products
  const supabase = getSupabaseClient();
  const { data } = supabase
    ? await supabase
        .from("products")
        .select("*")
        .neq("is_active", false)
        .gte("stock", 0)
        .order("created_at", { ascending: false })
        .limit(80)
    : { data: null };

  const allProducts = (data || []) as Record<string, unknown>[];
  const productSummary = buildProductSummary(allProducts);

  const storeName = (await getBusinessSettings()).business_name || "Online Store";
  const langPrompt = language === "el"
    ? "Reply in Greek. Greet with Καλημέρα or Καλησπέρα."
    : "Reply in English. Greet naturally.";

  const greeting = language === "el"
    ? `Welcome to ${storeName}!`
    : `Welcome to ${storeName}!`;

  const context = `${SYSTEM_PROMPT}\n${langPrompt}\nStore: ${storeName}\nGreeting: ${greeting}`;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: context },
          {
            role: "user",
            content: JSON.stringify({
              message,
              language,
              measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
              ACTUAL_PRODUCTS: productSummary,
            }),
          },
        ],
      }),
    });

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    // Enrich product recommendations with full data
    const enriched = (parsed.products || []).map((rec: { sku: string; reason: string }) => {
      const product = allProducts.find(p => p.sku === rec.sku);
      return product ? {
        ...buildProductSummary([product])[0],
        reason: rec.reason,
        url: `/product/${encodeURIComponent(rec.sku)}`,
      } : null;
    }).filter(Boolean);

    return NextResponse.json({
      reply: parsed.reply || "I couldn't process that. Please try again.",
      products: enriched,
      sizeAdvice: parsed.sizeAdvice || null,
    });
  } catch (error) {
    return NextResponse.json({
      reply: language === "el"
        ? "Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά."
        : "Sorry, something went wrong. Please try again.",
      products: [],
    });
  }
}
