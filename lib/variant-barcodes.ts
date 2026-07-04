// This module must only run on the server. Never import it from client components.

import { getSupabaseAdminClient } from "@/lib/supabase";

type VariantBarcodeRow = {
  id: string;
  variant_sku: string | null;
  barcode: string | null;
};

export class VariantBarcodeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "VariantBarcodeError";
    this.status = status;
  }
}

function adminClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new VariantBarcodeError(
      "Admin Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD.",
      500,
    );
  }
  return supabase as any;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );
}

export function generateBarcodeFromVariantSku(variantSku: string) {
  const barcode = cleanText(variantSku);
  if (!barcode) {
    throw new VariantBarcodeError("Variant SKU is required to generate barcode.", 400);
  }
  return barcode;
}

export async function hasStockMovementsForVariant(variantId: string) {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id")
    .eq("variant_id", variantId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new VariantBarcodeError(`Failed to check stock movements: ${error.message}`, 500);
  }

  return Boolean(data);
}

export async function isBarcodeAvailable(barcode: string, excludeVariantId?: string) {
  const cleanedBarcode = cleanText(barcode);
  if (!cleanedBarcode) return false;

  const supabase = adminClient();
  let query = supabase
    .from("product_variants")
    .select("id, variant_sku")
    .eq("barcode", cleanedBarcode)
    .limit(1);

  if (excludeVariantId) {
    query = query.neq("id", excludeVariantId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new VariantBarcodeError(`Failed to check barcode uniqueness: ${error.message}`, 500);
  }

  return !data;
}

async function getVariant(variantId: string): Promise<VariantBarcodeRow> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, variant_sku, barcode")
    .eq("id", variantId)
    .maybeSingle();

  if (error) {
    throw new VariantBarcodeError(`Failed to load variant: ${error.message}`, 500);
  }
  if (!data) {
    throw new VariantBarcodeError("Variant not found.", 404);
  }

  return data as VariantBarcodeRow;
}

export async function updateVariantBarcode({
  variantId,
  barcode,
}: {
  variantId: string;
  barcode: string;
  force?: boolean;
}) {
  const cleanedVariantId = cleanText(variantId);
  const cleanedBarcode = cleanText(barcode);

  if (!cleanedVariantId) {
    throw new VariantBarcodeError("Variant ID is required.", 400);
  }
  if (!cleanedBarcode) {
    throw new VariantBarcodeError("Barcode is required.", 400);
  }

  const variant = await getVariant(cleanedVariantId);
  const currentBarcode = cleanText(variant.barcode);
  if (currentBarcode === cleanedBarcode) {
    return { variant, updated: false, noChange: true };
  }

  const available = await isBarcodeAvailable(cleanedBarcode, cleanedVariantId);
  if (!available) {
    throw new VariantBarcodeError("Barcode is already used by another variant.", 409);
  }

  const hasMovements = await hasStockMovementsForVariant(cleanedVariantId);
  if (hasMovements) {
    throw new VariantBarcodeError(
      "This variant already has inventory or sales records, so its barcode cannot be changed directly.",
      409,
    );
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update({
      barcode: cleanedBarcode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanedVariantId)
    .select("id, variant_sku, barcode")
    .single();

  if (error) {
    throw new VariantBarcodeError(`Failed to update barcode: ${error.message}`, 500);
  }

  return { variant: data as VariantBarcodeRow, updated: true, noChange: false };
}

export type GenerateVariantBarcodesResult = {
  generatedCount: number;
  skippedCount: number;
  errors: Array<{ variantId: string; variantSku?: string; message: string }>;
  updatedVariants: VariantBarcodeRow[];
};

export async function generateBarcodesForVariants({
  variantIds,
  mode,
  force = false,
}: {
  variantIds: unknown;
  mode: unknown;
  force?: boolean;
}): Promise<GenerateVariantBarcodesResult> {
  const ids = uniqueStrings(variantIds);
  const selectedMode = cleanText(mode) || "variant_sku";

  if (selectedMode !== "variant_sku") {
    throw new VariantBarcodeError('Only mode "variant_sku" is supported.', 400);
  }
  if (ids.length === 0) {
    throw new VariantBarcodeError("variantIds is required. Please select variants explicitly.", 400);
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, variant_sku, barcode")
    .in("id", ids);

  if (error) {
    throw new VariantBarcodeError(`Failed to load variants: ${error.message}`, 500);
  }

  const variants = (data || []) as VariantBarcodeRow[];
  const foundIds = new Set(variants.map((variant) => variant.id));
  const errors: GenerateVariantBarcodesResult["errors"] = ids
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ variantId: id, message: "Variant not found." }));
  const updatedVariants: VariantBarcodeRow[] = [];
  let skippedCount = 0;

  for (const variant of variants) {
    const existingBarcode = cleanText(variant.barcode);
    const nextBarcode = generateBarcodeFromVariantSku(cleanText(variant.variant_sku));

    if (existingBarcode && !force) {
      skippedCount += 1;
      continue;
    }

    if (existingBarcode && force) {
      const hasMovements = await hasStockMovementsForVariant(variant.id);
      if (hasMovements) {
        errors.push({
          variantId: variant.id,
          variantSku: cleanText(variant.variant_sku),
          message: "Variant already has stock movements or POS sales; barcode overwrite is not allowed.",
        });
        continue;
      }
    }

    if (existingBarcode === nextBarcode) {
      skippedCount += 1;
      continue;
    }

    const available = await isBarcodeAvailable(nextBarcode, variant.id);
    if (!available) {
      errors.push({
        variantId: variant.id,
        variantSku: cleanText(variant.variant_sku),
        message: `Generated barcode ${nextBarcode} is already used by another variant.`,
      });
      continue;
    }

    const { data: updated, error: updateError } = await supabase
      .from("product_variants")
      .update({
        barcode: nextBarcode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", variant.id)
      .select("id, variant_sku, barcode")
      .single();

    if (updateError) {
      errors.push({
        variantId: variant.id,
        variantSku: cleanText(variant.variant_sku),
        message: updateError.message,
      });
      continue;
    }

    updatedVariants.push(updated as VariantBarcodeRow);
  }

  return {
    generatedCount: updatedVariants.length,
    skippedCount,
    errors,
    updatedVariants,
  };
}
