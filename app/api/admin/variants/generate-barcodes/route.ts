import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { generateBarcodesForVariants, VariantBarcodeError } from "@/lib/variant-barcodes";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function barcodeError(error: unknown) {
  if (error instanceof VariantBarcodeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Failed to generate variant barcodes.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "labels:write"))) return unauthorized();

  try {
    const body = (await request.json()) as {
      variantIds?: unknown;
      mode?: unknown;
      force?: unknown;
    };

    const result = await generateBarcodesForVariants({
      variantIds: body.variantIds,
      mode: body.mode || "variant_sku",
      force: body.force === true,
    });

    return NextResponse.json({
      ok: result.errors.length === 0,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      errors: result.errors,
      updatedVariants: result.updatedVariants,
    });
  } catch (error) {
    return barcodeError(error);
  }
}
