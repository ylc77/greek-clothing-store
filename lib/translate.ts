/**
 * Shared DeepSeek translation for product content.
 *
 * Used by both the single-product translate API route and the CSV import
 * batch-translation flow.  All callers stay server-side so the API key is
 * never exposed to the browser.
 */

export type TranslationInput = {
  name_cn: string;
  description_cn: string;
};

export type TranslationOutput = {
  name_en: string;
  description_en: string;
  name_gr: string;
  description_gr: string;
};

export type TranslationResult =
  | { ok: true; translations: TranslationOutput }
  | { ok: false; error: string };

function envString(key: string) {
  return (process.env[key] || "").trim();
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Translation response was not valid JSON.");
  }

  return JSON.parse(match[0]) as Record<string, unknown>;
}

/**
 * Call DeepSeek Chat Completions API to translate Chinese product content
 * into English and Greek.
 *
 * Returns `{ ok: true, translations }` on success, or
 * `{ ok: false, error }` on failure — it never throws.
 */
export async function translateProductContent(
  input: TranslationInput,
): Promise<TranslationResult> {
  const apiKey = envString("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "DEEPSEEK_API_KEY is not configured." };
  }

  const model =
    envString("DEEPSEEK_TRANSLATION_MODEL") || "deepseek-chat";

  const systemPrompt =
    "You translate product catalog content for a Greek fashion store. " +
    "Return only JSON with keys name_gr, description_gr, name_en, description_en. " +
    "Preserve SKU-like text, sizes, brand names, and numbers. Do not add facts.";

  try {
    const response = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                name_cn: input.name_cn,
                description_cn: input.description_cn,
              }),
            },
          ],
        }),
      },
    );

    const data = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error?.message || `DeepSeek API error (${response.status})`,
      };
    }

    const content = data?.choices?.[0]?.message?.content || "{}";
    const translations = extractJson(content);

    const stringOrEmpty = (v: unknown) =>
      typeof v === "string" ? v.trim() : "";

    return {
      ok: true,
      translations: {
        name_gr: stringOrEmpty(translations.name_gr),
        description_gr: stringOrEmpty(translations.description_gr),
        name_en: stringOrEmpty(translations.name_en),
        description_en: stringOrEmpty(translations.description_en),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "DeepSeek translation request failed.",
    };
  }
}

/**
 * Determine which language fields are missing and need translation.
 * Returns null if nothing needs translation (all 4 target fields already filled).
 */
export function missingTranslationFields(row: {
  name_cn?: unknown;
  description_cn?: unknown;
  name_en?: unknown;
  description_en?: unknown;
  name_gr?: unknown;
  description_gr?: unknown;
}): TranslationInput | null {
  const nameCn = typeof row.name_cn === "string" ? row.name_cn.trim() : "";
  const descCn =
    typeof row.description_cn === "string" ? row.description_cn.trim() : "";

  // Nothing to translate from
  if (!nameCn && !descCn) return null;

  const nameEn = typeof row.name_en === "string" ? row.name_en.trim() : "";
  const descEn =
    typeof row.description_en === "string" ? row.description_en.trim() : "";
  const nameGr = typeof row.name_gr === "string" ? row.name_gr.trim() : "";
  const descGr =
    typeof row.description_gr === "string" ? row.description_gr.trim() : "";

  // If ALL target fields are already filled, skip translation
  if (nameEn && descEn && nameGr && descGr) return null;

  return { name_cn: nameCn, description_cn: descCn };
}

/**
 * Batch-translate rows in groups with controlled concurrency.
 *
 * - Processes items in groups of `groupSize` (default 3).
 * - Groups run sequentially; items within a group run concurrently.
 * - A single failure does NOT interrupt the batch.
 * - Only translates when target fields are actually missing.
 *
 * Returns the merged translation results keyed by row index.
 */
export async function batchTranslateRows(
  rows: Array<{
    name_cn?: unknown;
    description_cn?: unknown;
    name_en?: unknown;
    description_en?: unknown;
    name_gr?: unknown;
    description_gr?: unknown;
  }>,
  groupSize = 3,
): Promise<
  Array<{
    translated: boolean;
    translateError?: string;
    name_en: string;
    description_en: string;
    name_gr: string;
    description_gr: string;
  }>
> {
  const results: Array<{
    translated: boolean;
    translateError?: string;
    name_en: string;
    description_en: string;
    name_gr: string;
    description_gr: string;
  }> = rows.map(() => ({
    translated: false,
    name_en: "",
    description_en: "",
    name_gr: "",
    description_gr: "",
  }));

  // Identify rows that need translation
  const needsTranslation: Array<{ index: number; input: TranslationInput }> =
    [];
  rows.forEach((row, index) => {
    const input = missingTranslationFields(row);
    if (input) {
      needsTranslation.push({ index, input });
    }
  });

  if (needsTranslation.length === 0) return results;

  // Process in groups
  for (let g = 0; g < needsTranslation.length; g += groupSize) {
    const group = needsTranslation.slice(g, g + groupSize);

    const groupResults = await Promise.all(
      group.map(async ({ index, input }) => {
        const result = await translateProductContent(input);
        if (result.ok) {
          results[index] = { translated: true, ...result.translations };
        } else {
          results[index] = {
            translated: false,
            translateError: result.error,
            name_en: "",
            description_en: "",
            name_gr: "",
            description_gr: "",
          };
        }
        return { index, result };
      }),
    );

    void groupResults;
  }

  return results;
}
