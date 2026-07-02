import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordIsValid,
  validateProductPayload,
  type AdminProductPayload,
  type ProductMutation,
} from "@/lib/admin-products";
import { invalidateProductsCache } from "@/lib/cache";
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

type ValidImportRow = {
  rowNumber: number;
  mutation: ProductMutation;
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

function skuKey(sku: string) {
  return sku.trim().toUpperCase();
}

function parseCsvSizeStock(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const sizeStock: Record<string, number> = {};
  value.split(/[,\s]+/).forEach((pair) => {
    const [size, qty] = pair.split(":");
    if (!size || qty === undefined) return;

    const parsedQty = parseInt(qty, 10);
    if (!Number.isNaN(parsedQty) && parsedQty >= 0) {
      sizeStock[size.trim().toUpperCase()] = parsedQty;
    }
  });

  return Object.keys(sizeStock).length > 0 ? sizeStock : null;
}

function readableImportMessage(message: string) {
  return message
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower.includes("sku is required")) return "SKU 必填";
      if (lower.includes("category")) return "一级分类无效或为空，请填写后台已有分类";
      if (lower.includes("subcategory")) return "二级分类无效，请填写该一级分类下的二级分类";
      if (lower.includes("price")) return "价格必须是数字，不能带 € 或文字";
      if (lower.includes("stock")) return "库存必须是数字";
      if (lower.includes("vat")) return "VAT 必须是数字";
      if (lower.includes("duplicate key") || lower.includes("unique")) return "SKU 重复或违反唯一约束";
      if (lower.includes("invalid input syntax")) return "字段格式不正确，请检查数字、布尔值或 JSON";
      if (lower.includes("violates row-level security")) return "数据库权限不足，请检查后台 service role 配置";
      if (lower.includes("column") && lower.includes("does not exist")) return `数据库缺少字段：${part}`;
      return part;
    })
    .join("；");
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

  const validRows: ValidImportRow[] = [];
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
        message: readableImportMessage(errors.join("; ")),
        translated: false,
      });
      return;
    }

    const sizeStock = parseCsvSizeStock(row.size_stock);
    if (sizeStock) {
      (mutation as Record<string, unknown>).size_stock = sizeStock;
      (mutation as Record<string, unknown>).stock = Object.values(sizeStock).reduce(
        (sum, qty) => sum + qty,
        0,
      );
    }

    validRows.push({ rowNumber, mutation });
  });

  const translateResults = await batchTranslateRows(
    validRows.map((row) => row.mutation),
    3,
  );

  validRows.forEach(({ mutation }, index) => {
    const translated = translateResults[index];
    if (!translated) return;

    if (!mutation.name_en && translated.name_en) mutation.name_en = translated.name_en;
    if (!mutation.description_en && translated.description_en) {
      mutation.description_en = translated.description_en;
    }
    if (!mutation.name_gr && translated.name_gr) mutation.name_gr = translated.name_gr;
    if (!mutation.description_gr && translated.description_gr) {
      mutation.description_gr = translated.description_gr;
    }
  });

  const lastIndexBySku = new Map<string, number>();
  validRows.forEach((row, index) => {
    lastIndexBySku.set(skuKey(row.mutation.sku), index);
  });

  const rowsToUpsert = validRows.filter((row, index) => {
    return lastIndexBySku.get(skuKey(row.mutation.sku)) === index;
  });

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rowsToUpsert.map((row) => row.mutation as any),
        { onConflict: "sku" },
      );

    if (error) {
      validRows.forEach((row, index) => {
        const translated = translateResults[index];
        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: false,
          message: readableImportMessage(error.message),
          translated: translated?.translated ?? false,
          translateError: translated?.translateError,
        });
      });
    } else {
      validRows.forEach((row, index) => {
        const translated = translateResults[index];
        const isLastDuplicate = lastIndexBySku.get(skuKey(row.mutation.sku)) === index;
        const parts: string[] = [
          isLastDuplicate ? "已导入" : "已跳过：同一 CSV 中后面的相同 SKU 已覆盖",
        ];
        if (translated?.translated) parts.push("已翻译");

        results.push({
          rowNumber: row.rowNumber,
          sku: row.mutation.sku,
          ok: true,
          message: parts.join("；"),
          translated: translated?.translated ?? false,
          translateError: translated?.translateError,
        });
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);

  if (results.some((result) => result.ok) && rowsToUpsert.length > 0) {
    invalidateProductsCache();
  }

  const translatedCount = results.filter((result) => result.translated).length;
  const translateFailureCount = results.filter(
    (result) => result.translateError,
  ).length;

  return NextResponse.json({
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    translatedCount,
    translateFailureCount,
    results,
  });
}
