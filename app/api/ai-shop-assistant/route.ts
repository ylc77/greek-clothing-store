import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getBusinessSettings } from "@/lib/settings";

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
- If measurements are incomplete, ask for the missing fields: height, weight, bust, waist, hip.
- Size advice should sound like a helpful human store assistant, not an absolute guarantee.
- For size advice, give the most likely size first, then one relaxed/slim alternative only if useful.
- If no detailed size chart exists, clearly say the advice is approximate and ask for bust/shoulder/waist/hip measurements for better accuracy when relevant.
- If a likely size is not available, mention the current available-size limitation and suggest the closest available option carefully.
- Do NOT discuss politics, health advice, shipping, returns, payments, or anything not about this store's products.
- If asked about prices, all prices are in EUR and include VAT.

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

PRIORITY 1: size_chart exists on CURRENT_PRODUCT
- Compare customer measurements against the size_chart and recommend the closest size.
- Always mention available sizes from size_stock keys or the sizes field.
- Say: "Based on the size chart for this [product name], size [X] looks like the best starting point."
- If the customer seems between sizes, mention the nearest alternative for a looser or slimmer fit.

PRIORITY 2: no size_chart, but available_sizes exist
- Always mention available sizes first.
- Estimate from height, weight, fit_type, and category.
- Add one sentence saying this is approximate because this product does not have a detailed size chart yet.
- For shoes, if no foot_length is provided, ask for foot length in cm.
- For bags, hats, jewelry, luggage, and accessories, say the product is One Size.

PRIORITY 3: no sizes at all
- Say size information is not available yet and suggest contacting the store on WhatsApp or visiting in store.

WHEN CURRENT_PRODUCT IS PROVIDED:
- Always start with "For this [product name]..." and mention the specific product.
- Never say "most tops" or "bottoms"; talk about the specific product only.

WHATSAPP MENTION:
- The chat panel already has a WhatsApp contact footer. Do NOT repeat WhatsApp in your reply unless the user explicitly asks how to contact the store.
- Keep the size disclaimer short and WhatsApp-free: "This is only a size recommendation. For the most accurate fit, try it in store."`;

function buildProductSummary(products: Record<string, unknown>[]) {
  return products.map((p) => ({
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
    material_verified: Boolean(p.material_verified),
    brand: p.brand || "",
    color: p.color || "",
    style_tags: p.ai_keywords || [],
    image_url: p.image_url || "",
  }));
}

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 10;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) || []).filter((t) => now - t < 60000);
  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps.slice(-20));
  return true;
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
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const language = body.language === "en" ? "en" : "el";
  const measurements = body.measurements || {};
  const productContext = body.productContext || null;

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({
      reply: language === "el"
        ? "Στέλνετε μηνύματα πολύ γρήγορα. Παρακαλούμε δοκιμάστε ξανά σε λίγο."
        : "You are sending messages too quickly. Please try again later.",
    });
  }

  const localReply = getLocalReply(message, language);
  if (localReply) {
    return NextResponse.json({ reply: localReply, products: [] });
  }

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({
      reply: language === "el"
        ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλούμε επικοινωνήστε μαζί μας στο WhatsApp."
        : "AI assistant is temporarily unavailable. Please contact us on WhatsApp.",
    });
  }

  const supabase = getSupabaseClient();
  const { data } = supabase
    ? await (supabase as any)
        .from("products")
        .select("sku, name_en, name_gr, category, subcategory, price, stock, sizes, size_stock, size_chart, fit_type, material, material_verified, ai_keywords, image_url, color, brand")
        .neq("is_active", false)
        .gte("stock", 0)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: null };

  const allProducts = (data || []) as Record<string, unknown>[];
  const productSummary = buildProductSummary(allProducts);

  const storeName = (await getBusinessSettings()).business_name || "Online Store";
  const langPrompt = language === "el"
    ? 'Reply in Greek. Greet naturally with "Γεια σας".'
    : "Reply in English. Greet naturally.";

  const context = `${SYSTEM_PROMPT}\n${langPrompt}\nStore: ${storeName}`;

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

    const enriched = (parsed.products || [])
      .map((rec: { sku: string; reason: string }) => {
        const product = allProducts.find((p) => p.sku === rec.sku);
        return product
          ? {
              ...buildProductSummary([product])[0],
              reason: rec.reason,
              url: `/product/${encodeURIComponent(rec.sku)}`,
            }
          : null;
      })
      .filter(Boolean);

    return NextResponse.json({
      reply: parsed.reply || "I couldn't process that. Please try again.",
      products: enriched,
      sizeAdvice: parsed.sizeAdvice || null,
    });
  } catch {
    return NextResponse.json({
      reply: language === "el"
        ? "Ο AI βοηθός δεν είναι προσωρινά διαθέσιμος. Παρακαλούμε επικοινωνήστε μαζί μας στο WhatsApp."
        : "AI assistant is temporarily unavailable. Please contact us on WhatsApp.",
      products: [],
    });
  }
}
