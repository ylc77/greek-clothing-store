import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordIsValid,
  validateProductPayload,
  type AdminProductPayload,
  type ProductMutation,
} from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { batchTranslateRows } from "@/lib/translate";

type ImportRow = {
  rowNumber?: number;
  [key: string]: unknown;
};

type ImportResult = {
  rowNumber: number;
  sku: string;
  ok: boolean;
  message: string;
  translated: boolean;
  translateError?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD.",
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) {
    return unauthorized();
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const body = (await request.json()) as { rows?: ImportRow[] };
  const rows = Array.isArray(body.rows) ? body.rows : [];

  // ── Phase 1: validate every row ──────────────────────────────────
  const validRows: Array<{ rowNumber: number; mutation: ProductMutation }> = [];
  const results: ImportResult[] = [];

  rows.forEach((row, index) => {
    const rowNumber = Number(row.rowNumber || index + 2);
    const { errors, mutation } = validateProductPayload(
      row as AdminProductPayload,
    );

    if (!mutation) {
      results.push({
        rowNumber,
        sku: typeof row.sku === "string" ? row.sku : "",
        ok: false,
        message: errors.join("; "),
        translated: false,
      });
      return;
    }

    validRows.push({ rowNumber, mutation });
  });

  // ── Phase 2: batch-translate missing fields ──────────────────────
  const translateResults = await batchTranslateRows(
    validRows.map((r) => r.mutation),
    3,
  );

  // Merge translations into mutations — NEVER overwrite user-provided data
  validRows.forEach(({ mutation }, index) => {
    const tr = translateResults[index];
    if (!tr) return;

    if (!mutation.name_en && tr.name_en) mutation.name_en = tr.name_en;
    if (!mutation.description_en && tr.description_en)
      mutation.description_en = tr.description_en;
    if (!mutation.name_gr && tr.name_gr) mutation.name_gr = tr.name_gr;
    if (!mutation.description_gr && tr.description_gr)
      mutation.description_gr = tr.description_gr;
  });

  // ── Phase 3: upsert into Supabase ────────────────────────────────
  if (validRows.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(
        validRows.map((row) => row.mutation),
        { onConflict: "sku" },
      );

    if (error) {
      validRows.forEach((row, index) => {
        const tr = translateResults[index];
        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: false,
          message: error.message,
          translated: tr?.translated ?? false,
          translateError: tr?.translateError,
        });
      });
    } else {
      validRows.forEach((row, index) => {
        const tr = translateResults[index];
        const parts: string[] = ["已导入"];
        if (tr?.translated) parts.push("已翻译");
        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: true,
          message: parts.join("，"),
          translated: tr?.translated ?? false,
          translateError: tr?.translateError,
        });
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);

  const translatedCount = results.filter((r) => r.translated).length;
  const translateFailureCount = results.filter(
    (r) => r.translateError,
  ).length;

  return NextResponse.json({
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
    translatedCount,
    translateFailureCount,
    results,
  });
}
