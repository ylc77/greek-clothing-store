// Server-only transactional Variant barcode boundary.

import { getSupabaseAdminClient } from "@/lib/supabase";

export type VariantBarcodeRow = {
  id: string;
  variant_sku: string | null;
  barcode: string | null;
};

export class VariantBarcodeError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BARCODE_INVALID_ARGUMENT") {
    super(message);
    this.name = "VariantBarcodeError";
    this.status = status;
    this.code = code;
  }
}

function adminClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new VariantBarcodeError("服务端 Supabase 未配置，条码写入已阻断。", 503, "BARCODE_RPC_UNAVAILABLE");
  }
  return supabase as any;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

export function generateBarcodeFromVariantSku(variantSku: string) {
  const barcode = cleanText(variantSku);
  if (!barcode) throw new VariantBarcodeError("Variant SKU is required to generate barcode.");
  return barcode;
}

function mapRpcError(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || "");
  if (message.includes("BARCODE_ALREADY_IN_USE") || message.includes("BARCODE_OPERATION_CONFLICT")) {
    return new VariantBarcodeError("条码已被其他 Variant 使用，或该业务 ID 对应了不同请求。", 409, "BARCODE_CONFLICT");
  }
  if (message.includes("BARCODE_HISTORY_LOCKED")) {
    return new VariantBarcodeError("该 Variant 已有库存或销售历史，条码不能再修改。", 409, "BARCODE_HISTORY_LOCKED");
  }
  if (message.includes("BARCODE_VARIANT_NOT_FOUND")) {
    return new VariantBarcodeError("Variant 不存在。", 404, "BARCODE_VARIANT_NOT_FOUND");
  }
  if (message.includes("BARCODE_INVALID") || message.includes("BARCODE_DUPLICATE_VARIANT")) {
    return new VariantBarcodeError("条码请求参数无效。", 400, "BARCODE_INVALID_ARGUMENT");
  }
  return new VariantBarcodeError("事务条码 RPC 缺失、无权执行或不可用，未写入任何条码。", 503, "BARCODE_RPC_UNAVAILABLE");
}

async function applyBarcodes({
  clientRequestId,
  assignments,
  mode,
  actor,
}: {
  clientRequestId: string;
  assignments: Array<{ variant_id: string; barcode?: string }>;
  mode: "variant_sku" | "explicit";
  actor: string;
}) {
  const requestId = cleanText(clientRequestId);
  const cleanActor = cleanText(actor);
  if (!requestId) throw new VariantBarcodeError("clientRequestId is required.");
  if (!cleanActor) throw new VariantBarcodeError("actor is required.");
  const { data, error } = await adminClient().rpc("variant_barcodes_apply_rpc", {
    p_client_request_id: requestId,
    p_assignments: assignments,
    p_mode: mode,
    p_actor: cleanActor,
  });
  if (error || !data) throw mapRpcError(error);
  return data as {
    generated_count: number;
    skipped_count: number;
    updated_variants: VariantBarcodeRow[];
    skipped_variants: VariantBarcodeRow[];
    already_processed: boolean;
  };
}

export async function updateVariantBarcode({
  variantId,
  barcode,
  clientRequestId,
  actor,
}: {
  variantId: string;
  barcode: string;
  clientRequestId: string;
  actor: string;
  force?: boolean;
}) {
  const cleanedVariantId = cleanText(variantId);
  const cleanedBarcode = cleanText(barcode);
  if (!cleanedVariantId) throw new VariantBarcodeError("Variant ID is required.");
  if (!cleanedBarcode) throw new VariantBarcodeError("Barcode is required.");

  const result = await applyBarcodes({
    clientRequestId,
    assignments: [{ variant_id: cleanedVariantId, barcode: cleanedBarcode }],
    mode: "explicit",
    actor,
  });
  const variant = result.updated_variants[0] || result.skipped_variants[0];
  return {
    variant,
    updated: result.generated_count > 0,
    noChange: result.generated_count === 0,
    alreadyProcessed: result.already_processed,
  };
}

export type GenerateVariantBarcodesResult = {
  generatedCount: number;
  skippedCount: number;
  errors: Array<{ variantId: string; variantSku?: string; message: string }>;
  updatedVariants: VariantBarcodeRow[];
  alreadyProcessed: boolean;
};

export async function generateBarcodesForVariants({
  variantIds,
  mode,
  clientRequestId,
  actor,
}: {
  variantIds: unknown;
  mode: unknown;
  clientRequestId: string;
  actor: string;
  force?: boolean;
}): Promise<GenerateVariantBarcodesResult> {
  const ids = uniqueStrings(variantIds);
  const selectedMode = cleanText(mode) || "variant_sku";
  if (selectedMode !== "variant_sku") throw new VariantBarcodeError('Only mode "variant_sku" is supported.');
  if (ids.length === 0) throw new VariantBarcodeError("variantIds is required. Please select variants explicitly.");

  const result = await applyBarcodes({
    clientRequestId,
    assignments: ids.map((variantId) => ({ variant_id: variantId })),
    mode: "variant_sku",
    actor,
  });
  return {
    generatedCount: result.generated_count,
    skippedCount: result.skipped_count,
    errors: [],
    updatedVariants: result.updated_variants,
    alreadyProcessed: result.already_processed,
  };
}
