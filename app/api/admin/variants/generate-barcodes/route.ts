import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { generateBarcodesForVariants, VariantBarcodeError } from "@/lib/variant-barcodes";

function barcodeError(error: unknown) {
  if (error instanceof VariantBarcodeError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Failed to generate variant barcodes.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "labels:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("barcode_labels"))) return featureDisabledResponse("barcode_labels");

  try {
    const body = (await request.json()) as {
      variantIds?: unknown;
      mode?: unknown;
      force?: unknown;
      clientRequestId?: unknown;
    };

    const result = await generateBarcodesForVariants({
      variantIds: body.variantIds,
      mode: body.mode || "variant_sku",
      force: body.force === true,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
      actor: adminActorFromContext(authorization.context),
    });

    return NextResponse.json({
      ok: result.errors.length === 0,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      errors: result.errors,
      updatedVariants: result.updatedVariants,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    return barcodeError(error);
  }
}
