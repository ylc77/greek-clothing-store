import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function cleanText(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "ai:write"))) return unauthorized();
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const product = body.product || {};
  const category = cleanText(product.category, 60);
  const subcategory = cleanText(product.subcategory, 80);
  const color = cleanText(product.color, 80);
  const brand = cleanText(product.brand, 80);
  const material = cleanText(product.material, 120);
  const sizes = cleanText(product.sizes, 120);
  const photoHints = cleanText(product.photo_hints, 300);
  const nameCn = cleanText(product.name_cn, 120);
  const descriptionCn = cleanText(product.description_cn, 500);
  const notes = cleanText(product.notes, 500);

  if (!category && !subcategory && !nameCn && !descriptionCn && !notes) {
    return NextResponse.json({ error: "请至少填写分类、商品名或备注后再生成文案。" }, { status: 400 });
  }

  const prompt = `You are a senior ecommerce copywriter for a small fashion boutique in Greece.

Create concise, trustworthy product copy for Greek shoppers and marketplace listings such as Skroutz.
The copy should feel attractive, searchable, and realistic without sounding exaggerated.

Product hints:
- Existing Chinese name: ${nameCn || "-"}
- Existing Chinese description: ${descriptionCn || "-"}
- Category: ${category || "-"} / ${subcategory || "-"}
- Color: ${color || "-"}
- Brand: ${brand || "-"}
- Material: ${material || "-"}
- Sizes: ${sizes || "-"}
- Owner notes: ${notes || "-"}
- Photo hints: ${photoHints || "-"}

Return ONLY valid JSON:
{
  "name_cn": "Chinese product name",
  "description_cn": "Chinese product description, 1-2 short sentences",
  "name_en": "English product name",
  "description_en": "English product description, 1-2 short sentences",
  "name_gr": "Greek product name",
  "description_gr": "Greek product description, 1-2 short sentences",
  "fit_type": "regular" | "slim" | "loose",
  "material": "short material or fabric description in Chinese, only if reasonably inferable",
  "ai_keywords": ["5-8 lowercase English search keywords"],
  "style_tags": ["3-5 short style tags"]
}

Marketplace writing rules:
- Product names should be clear search titles: product type + gender/category + color/style/detail when known.
- Greek names should sound natural for Greek ecommerce, for example: "Γυναικείο Φόρεμα", "Ανδρικό Πουκάμισο", "Casual Τσάντα Χειρός".
- English names should be simple international retail names, not literal machine translations.
- Chinese names should help the shop owner recognize the item quickly.
- Descriptions should sell the use case: everyday wear, office, evening, travel, summer, layering, gift, etc. only when appropriate from the hints.
- Mention fit, styling, comfort, and occasion when useful, but keep each description to 1-2 short sentences.
- If useful for Skroutz search, include common category terms naturally, not as keyword spam.
- Do not invent luxury brands.
- Do not promise discounts, exact material, waterproofing, handmade, or origin unless provided.
- Do not promise availability, delivery speed, warranty, or stock quantity.
- If material is unknown, describe style and usage instead of guessing exact fabric.
- If image content is not explicitly described in owner notes or photo hints, do not claim exact patterns or fabric.
- fit_type must be one of regular, slim, loose.
- Avoid clickbait, ALL CAPS, emojis, and overly long titles.
- Greek must be natural modern Greek.
- Return ONLY JSON.`;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_TRANSLATION_MODEL || "deepseek-chat",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: result?.error?.message || "AI copy generation failed" }, { status: response.status });
    }

    const content = result?.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(content);

    return NextResponse.json({
      name_cn: cleanText(data.name_cn, 120),
      description_cn: cleanText(data.description_cn, 500),
      name_en: cleanText(data.name_en, 120),
      description_en: cleanText(data.description_en, 500),
      name_gr: cleanText(data.name_gr, 120),
      description_gr: cleanText(data.description_gr, 500),
      fit_type: ["regular", "slim", "loose"].includes(data.fit_type) ? data.fit_type : "regular",
      material: cleanText(data.material, 120),
      ai_keywords: Array.isArray(data.ai_keywords) ? data.ai_keywords.slice(0, 10).join(", ") : cleanText(data.ai_keywords, 200),
      style_tags: Array.isArray(data.style_tags) ? data.style_tags.slice(0, 6).join(", ") : cleanText(data.style_tags, 160),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI copy generation failed" }, { status: 500 });
  }
}
