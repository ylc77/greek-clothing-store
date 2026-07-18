import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";
import { CsvInputError, readRequestBytesWithLimit } from "@/lib/csv-parser";
import { batchTranslateRows } from "@/lib/translate";

export const dynamic = "force-dynamic";

const MAX_TRANSLATION_BODY_BYTES = 256 * 1024;
const MAX_TRANSLATION_ROWS = 50;

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "products:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");
  if (!(await isFeatureEnabledUncached("ai_tools"))) return featureDisabledResponse("ai_tools");

  let raw: string;
  try {
    const bytes = await readRequestBytesWithLimit(request, MAX_TRANSLATION_BODY_BYTES);
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    const tooLarge = error instanceof CsvInputError && error.code === "CSV_FILE_TOO_LARGE";
    return NextResponse.json(
      {
        error: tooLarge ? "Translation request is too large." : "Translation request must be valid UTF-8.",
        code: tooLarge ? "CSV_TRANSLATION_TOO_LARGE" : "INVALID_ARGUMENT",
      },
      { status: tooLarge ? 413 : 400 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Translation request must be valid JSON.", code: "INVALID_ARGUMENT" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_TRANSLATION_ROWS) {
    return NextResponse.json({ error: `Translate between 1 and ${MAX_TRANSLATION_ROWS} rows per request.`, code: "INVALID_ARGUMENT" }, { status: 400 });
  }
  let rows: Array<{
    rowNumber: number;
    name_cn: string;
    description_cn: string;
    name_en: string;
    description_en: string;
    name_gr: string;
    description_gr: string;
  }>;
  try {
    rows = body.rows.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`row ${index + 1}`);
      const row = value as Record<string, unknown>;
      const string = (field: string, max: number) => {
        const result = typeof row[field] === "string" ? String(row[field]).trim() : "";
        if (result.length > max) throw new Error(field);
        return result;
      };
      return {
        rowNumber: Number(row.rowNumber),
        name_cn: string("name_cn", 1_000),
        description_cn: string("description_cn", 8_000),
        name_en: string("name_en", 1_000),
        description_en: string("description_en", 8_000),
        name_gr: string("name_gr", 1_000),
        description_gr: string("description_gr", 8_000),
      };
    });
  } catch {
    return NextResponse.json({ error: "Translation rows contain invalid fields.", code: "INVALID_ARGUMENT" }, { status: 400 });
  }
  if (rows.some((row) => !Number.isSafeInteger(row.rowNumber))) {
    return NextResponse.json({ error: "Each translation row requires a valid rowNumber.", code: "INVALID_ARGUMENT" }, { status: 400 });
  }

  const translations = await batchTranslateRows(rows, 3, { timeoutMs: 12_000 });
  const results = translations.map((translation, index) => ({
    rowNumber: rows[index]!.rowNumber,
    ...translation,
  }));
  return NextResponse.json({
    results,
    translatedCount: results.filter((result) => result.translated).length,
    failureCount: results.filter((result) => result.translateError).length,
    databaseWrites: 0,
  });
}
