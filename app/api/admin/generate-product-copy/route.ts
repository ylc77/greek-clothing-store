import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function cleanText(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function POST(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

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
  const nameCn = cleanText(product.name_cn, 120);
  const descriptionCn = cleanText(product.description_cn, 500);
  const notes = cleanText(product.notes, 500);

  if (!category && !subcategory && !nameCn && !descriptionCn && !notes) {
    return NextResponse.json({ error: "请至少填写分类、商品名或备注后再生成文案。" }, { status: 400 });
  }

  const prompt = `You are writing product copy for a small fashion boutique in Greece.

Create concise, realistic ecommerce product names and descriptions.

Product hints:
- Existing Chinese name: ${nameCn || "-"}
- Existing Chinese description: ${descriptionCn || "-"}
- Category: ${category || "-"} / ${subcategory || "-"}
- Color: ${color || "-"}
- Brand: ${brand || "-"}
- Material: ${material || "-"}
- Sizes: ${sizes || "-"}
- Owner notes: ${notes || "-"}

Return ONLY valid JSON:
{
  "name_cn": "Chinese product name",
  "description_cn": "Chinese product description, 1-2 short sentences",
  "name_en": "English product name",
  "description_en": "English product description, 1-2 short sentences",
  "name_gr": "Greek product name",
  "description_gr": "Greek product description, 1-2 short sentences"
}

Rules:
- Do not invent luxury brands.
- Do not promise discounts, exact material, waterproofing, handmade, or origin unless provided.
- If material is unknown, describe style and usage instead of guessing exact fabric.
- Keep names natural for shoppers, not keyword spam.
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
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI copy generation failed" }, { status: 500 });
  }
}
