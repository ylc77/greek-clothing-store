import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  validateProductPayload,
  type AdminProductPayload,
  type ProductMutation,
} from "@/lib/admin-products";
import type { VariantProcurement } from "@/lib/types";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { invalidateProductsCache } from "@/lib/cache";
import { syncProductInventoryFromLegacy } from "@/lib/erp-inventory";
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
  variantProcurement?: Record<string, VariantProcurement>;
};

type ErpSyncError = {
  sku: string;
  productId?: number;
  message: string;
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
  for (const match of value.matchAll(/([^,;]+?):\s*(\d+)/g)) {
    const size = match[1]?.trim();
    const parsedQty = parseInt(match[2], 10);
    if (!size) continue;
    if (!Number.isNaN(parsedQty) && parsedQty >= 0) {
      sizeStock[size.trim().toUpperCase()] = parsedQty;
    }
  }

  return Object.keys(sizeStock).length > 0 ? sizeStock : null;
}

function parseCsvVariantValues(value: unknown) {
  const result: Record<string, string> = {};
  if (typeof value !== "string" || !value.trim()) return result;

  value.split(/[;,]/).forEach((pair) => {
    const separator = pair.indexOf(":");
    if (separator <= 0) return;
    const size = pair.slice(0, separator).trim().toUpperCase();
    const item = pair.slice(separator + 1).trim();
    if (size && item) result[size] = item;
  });
  return result;
}

function parseCsvVariantProcurement(row: ImportRow) {
  const supplierSkus = parseCsvVariantValues(row.variant_supplier_skus);
  const costPrices = parseCsvVariantValues(row.variant_cost_prices);
  const reorderLevels = parseCsvVariantValues(row.variant_reorder_levels);
  const sizes = new Set([...Object.keys(supplierSkus), ...Object.keys(costPrices), ...Object.keys(reorderLevels)]);
  const result: Record<string, VariantProcurement> = {};

  sizes.forEach((size) => {
    const costPrice = Number(costPrices[size]);
    const reorderLevel = Number(reorderLevels[size]);
    result[size] = {
      supplier_sku: supplierSkus[size] || "",
      cost_price: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : null,
      reorder_level: Number.isFinite(reorderLevel) && reorderLevel >= 0 ? Math.trunc(reorderLevel) : null,
    };
  });

  return Object.keys(result).length > 0 ? result : undefined;
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
  if (!(await adminRequestHasPermissionAsync(request, "products:write"))) {
    return unauthorized();
  }
  if (!(await isFeatureEnabled("csv_import"))) return featureDisabledResponse("csv_import");

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return unavailable();
  }

  const body = (await request.json()) as { rows?: ImportRow[] };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const batchId = randomUUID();

  const validRows: ValidImportRow[] = [];
  const results: ImportResult[] = [];
  const erpSyncErrors: ErpSyncError[] = [];

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

    validRows.push({ rowNumber, mutation, variantProcurement: parseCsvVariantProcurement(row) });
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
      const affectedSkus = Array.from(
        new Set(rowsToUpsert.map((row) => row.mutation.sku.trim()).filter(Boolean)),
      );

      if (affectedSkus.length > 0) {
        const { data: affectedProducts, error: affectedProductsError } = await supabase
          .from("products")
          .select("id, sku")
          .in("sku", affectedSkus);

        if (affectedProductsError) {
          erpSyncErrors.push({
            sku: affectedSkus.join(", "),
            message: affectedProductsError.message,
          });
        } else {
          for (const product of affectedProducts || []) {
            const productId = Number(product.id);
            const productSku = typeof product.sku === "string" ? product.sku : "";

            if (!Number.isFinite(productId)) {
              erpSyncErrors.push({
                sku: productSku,
                message: "Invalid product ID for ERP inventory sync.",
              });
              continue;
            }

            try {
              const importedRow = rowsToUpsert.find((row) => skuKey(row.mutation.sku) === skuKey(productSku));
              await syncProductInventoryFromLegacy({
                productId,
                variantProcurement: importedRow?.variantProcurement,
                reason: "CSV 导入同步库存",
                sourceType: "csv_import",
                sourceId: batchId,
                movementType: "correction",
                idempotencyKey: `csv_import:${batchId}:${productId}`,
                createdBy: "admin",
              });
            } catch (syncError) {
              erpSyncErrors.push({
                sku: productSku,
                productId,
                message:
                  syncError instanceof Error
                    ? syncError.message
                    : "ERP inventory sync failed.",
              });
            }
          }

          const syncedSkuSet = new Set(
            (affectedProducts || [])
              .map((product) => (typeof product.sku === "string" ? product.sku : ""))
              .filter(Boolean),
          );
          affectedSkus
            .filter((sku) => !syncedSkuSet.has(sku))
            .forEach((sku) => {
              erpSyncErrors.push({
                sku,
                message: "Product was upserted but could not be loaded for ERP sync.",
              });
            });
        }
      }

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
    erpSyncWarning:
      erpSyncErrors.length > 0
        ? "CSV 已导入，但部分商品 ERP 库存同步失败，请运行对账 SQL 检查。"
        : undefined,
    erpSyncErrors,
    results,
  });
}
