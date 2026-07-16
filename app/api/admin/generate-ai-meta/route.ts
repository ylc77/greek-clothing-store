import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "ai:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  const apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const product = body.product || {};

  const prompt = `You are helping a fashion store owner fill in AI metadata fields for a product. Based on the product details below, suggest values.

Product info:
- Chinese name: ${product.name_cn || "—"}
- English name: ${product.name_en || "—"}
- Greek name: ${product.name_gr || "—"}
- Category: ${product.category || "—"} / ${product.subcategory || "—"}
- Price: €${product.price || "—"}
- Sizes: ${product.sizes || "—"}
- Description (EN): ${(product.description_en || "").slice(0, 200)}

Return ONLY valid JSON:
{
  "fit_type": "regular" | "slim" | "loose",
  "material": "fabric description in Chinese (e.g. 100%棉, 真丝混纺)",
  "ai_keywords": ["5-8 English keywords for search"],
  "style_tags": ["3-5 Greek+English style tags"]
}

Rules:
- fit_type: "slim" for fitted/tight clothes, "loose" for oversized, otherwise "regular"
- material: guess from product name/description; use Chinese text
- ai_keywords: lowercase English words shoppers would search (e.g., summer, floral, cotton)
- style_tags: short descriptive tags (e.g., casual, elegant, boho)
- Keep fit_type as one of: regular, slim, loose
- Return ONLY the JSON object, no other text.`;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(content);

    return NextResponse.json({
      fit_type: ["regular", "slim", "loose"].includes(data.fit_type) ? data.fit_type : "regular",
      material: typeof data.material === "string" ? data.material.slice(0, 80) : "",
      ai_keywords: Array.isArray(data.ai_keywords) ? data.ai_keywords.slice(0, 10).join(", ") : "",
      style_tags: Array.isArray(data.style_tags) ? data.style_tags.slice(0, 5).join(", ") : "",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI generation failed" }, { status: 500 });
  }
}
