import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";

type TranslationPayload = {
  name_cn?: unknown;
  description_cn?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Translation response was not valid JSON.");
  }

  return JSON.parse(match[0]);
}

export async function POST(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  const payload = (await request.json()) as TranslationPayload;
  const nameCn = stringValue(payload.name_cn);
  const descriptionCn = stringValue(payload.description_cn);

  if (!nameCn && !descriptionCn) {
    return NextResponse.json({ error: "请先填写中文名称或中文描述。" }, { status: 400 });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You translate product catalog content for a Greek fashion store. Return only JSON with keys name_gr, description_gr, name_en, description_en. Preserve SKU-like text, sizes, brand names, and numbers. Do not add facts."
        },
        {
          role: "user",
          content: JSON.stringify({
            name_cn: nameCn,
            description_cn: descriptionCn
          })
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error?.message || "OpenAI translation failed." },
      { status: response.status }
    );
  }

  try {
    const content = data?.choices?.[0]?.message?.content || "{}";
    const translations = extractJson(content);

    return NextResponse.json({
      name_gr: stringValue(translations.name_gr),
      description_gr: stringValue(translations.description_gr),
      name_en: stringValue(translations.name_en),
      description_en: stringValue(translations.description_en)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Translation response could not be parsed." },
      { status: 502 }
    );
  }
}
