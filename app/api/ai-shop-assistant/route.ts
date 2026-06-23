import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getBusinessSettings } from "@/lib/settings";

const SYSTEM_PROMPT = `You are a customer-facing shopping assistant for a clothing store in Greece (not in China).

CRITICAL LANGUAGE RULES — VIOLATING THESE IS UNACCEPTABLE:
- NEVER reply in Chinese to customers. This is a Greek store, not a Chinese store.
- If the customer writes in English → reply in English.
- If the customer writes in Greek → reply in Greek.
- If the customer writes in Chinese → do NOT reply in Chinese. Reply in the storefront language (Greek or English) and politely explain you can only assist in English or Greek.
- If the customer mixes English and Greek → reply in whichever language dominates their latest message. If tied, use the current storefront language.
- Chinese product fields (name_cn, description_cn) are internal admin references. NEVER show them to customers. They are NOT translations for customer use.
- If a product has ONLY Chinese text and no English/Greek translation, use category, price, size, image, and other non-Chinese fields to describe it, or say the product information is being updated.

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

MATERIAL FIELD:
- The material field may contain Chinese text (internal admin reference only).
- Each product also has material_verified (true/false).
- If material_verified is TRUE: you may tell customers the material (translate to English/Greek as needed).
- If material_verified is FALSE: do NOT tell customers the material as fact. Say:
  EN: "The material information has not been confirmed yet. Please contact us on WhatsApp for details."
  EL: "Οι πληροφορίες για το υλικό δεν έχουν επιβεβαιωθεί ακόμη. Παρακαλώ επικοινωνήστε μαζί μας μέσω WhatsApp για λεπτομέρειες."
- Translation rules (only when material_verified=true): 棉→cotton/βαμβάκι, 涤纶→polyester/πολυεστέρας, 真丝→silk/μετάξι, 牛仔→denim/τζην, 羊毛→wool/μαλλί, 亚麻→linen/λινό, 皮革→leather/δέρμα.

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

SIZE RECOMMENDATION RULES — TIERED BY DATA AVAILABILITY:

PRIORITY 1 — size_chart exists on CURRENT_PRODUCT:
- Compare customer measurements (bust, waist, hip, height, weight) against the size_chart.
- Recommend the closest matching size. If between sizes, suggest the larger one for comfort.
- Say: "Based on the size chart for this [product name], I recommend size [X]."
- Mention which sizes are currently in stock (use size_stock).

PRIORITY 2 — No size_chart, but available_sizes exist:
- Use height, weight, fit_type, and category to give an approximate recommendation.
- Say: "This product does not have a detailed size chart yet, so this is an approximate recommendation based on your height and weight. I suggest size [X]."
- For clothing (tops, shirts, dresses, jackets, hoodies, trousers, jeans, shorts, skirts): use height+weight to estimate S/M/L/XL.
- For shoes: if no foot_length provided, ask "What is your foot length in cm?" Do NOT guess shoe size.
- For bags, hats, jewelry, luggage, accessories: these are usually One Size — just confirm the product is one-size.

PRIORITY 3 — No size_chart AND no available_sizes:
- Say: "Size information is not available for this product yet. Please contact us on WhatsApp or visit the store for sizing help."
- Do NOT guess or invent sizes.

CATEGORY-SPECIFIC RULES:
- clothing (tops/dresses/shirts/jackets/hoodies/trousers/jeans/shorts/skirts): estimate S/M/L/XL from height+weight. Use fit_type (slim→size up, loose→size down).
- shoes: require foot_length_cm. Without it, ask for foot length. Do not guess from height alone.
- bags/hats/jewelry/luggage/accessories: these are One Size. Do not suggest S/M/L.
- If the product is marked One Size or has only one size in size_stock, say "This product is One Size."

WHEN CURRENT_PRODUCT IS PROVIDED:
- Always start with "For this [product name]..." and mention the specific product.
- Never say "most tops" or "bottoms" — talk about the specific product only.
- Never use plural "these products" when only one product is in context.

DISCLAIMER — say ONCE per response, maximum one sentence:
"This is only a size recommendation. For the most accurate fit, please contact us on WhatsApp or try it in store."`;

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
  const productContext = body.productContext || null;

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({ reply: language === "el" ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλώ επικοινωνήστε μαζί μας μέσω WhatsApp." : "AI assistant is temporarily unavailable. Please contact us on WhatsApp." });
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
              CURRENT_PRODUCT: productContext || undefined,
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
        ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλώ επικοινωνήστε μαζί μας μέσω WhatsApp."
        : "AI assistant is temporarily unavailable. Please contact us on WhatsApp.",
      products: [],
    });
  }
}
