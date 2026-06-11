import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordIsValid,
  validateProductPayload,
  type AdminProductPayload,
  type ProductMutation
} from "@/lib/admin-products";
import { getSupabaseAdminClient } from "@/lib/supabase";

type ImportRow = {
  rowNumber?: number;
  [key: string]: unknown;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json(
    { error: "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD." },
    { status: 500 }
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
  const validRows: Array<{ rowNumber: number; mutation: ProductMutation }> = [];
  const results: Array<{ rowNumber: number; sku: string; ok: boolean; message: string }> = [];

  rows.forEach((row, index) => {
    const rowNumber = Number(row.rowNumber || index + 2);
    const { errors, mutation } = validateProductPayload(row as AdminProductPayload);

    if (!mutation) {
      results.push({
        rowNumber,
        sku: typeof row.sku === "string" ? row.sku : "",
        ok: false,
        message: errors.join("; ")
      });
      return;
    }

    validRows.push({ rowNumber, mutation });
  });

  if (validRows.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(
        validRows.map((row) => row.mutation),
        { onConflict: "sku" }
      );

    if (error) {
      validRows.forEach((row) => {
        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: false,
          message: error.message
        });
      });
    } else {
      validRows.forEach((row) => {
        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: true,
          message: "Imported"
        });
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);

  return NextResponse.json({
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    results
  });
}
