import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { BarcodeBulkRequestError, parseBulkBarcodeRequest } from "@/lib/barcode-bulk-request";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { generateMissingBarcodesForVariants, VariantBarcodeError } from "@/lib/variant-barcodes";

function barcodeError(error: unknown) {
  if (error instanceof VariantBarcodeError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof BarcodeBulkRequestError) {
    return NextResponse.json({ error: error.message, code: error.code, operationSafeToDiscard: true }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body must be valid JSON.", code: "BARCODE_INVALID_ARGUMENT", operationSafeToDiscard: true }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Failed to generate variant barcodes.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "labels:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("barcode_labels"))) return featureDisabledResponse("barcode_labels");

  try {
    const body = parseBulkBarcodeRequest(await request.json());

    const result = await generateMissingBarcodesForVariants({
      variantIds: body.variantIds,
      clientRequestId: body.clientRequestId,
      actor: adminActorFromContext(authorization.context),
    });

    return NextResponse.json({
      ok: result.ok,
      requested: result.requested,
      generated: result.generated,
      skippedExisting: result.skippedExisting,
      failed: result.failed,
      items: result.items,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    return barcodeError(error);
  }
}
