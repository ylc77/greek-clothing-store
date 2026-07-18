import { NextRequest, NextResponse } from "next/server";
import { adminActorFromContext, authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { updateVariantBarcode, VariantBarcodeError } from "@/lib/variant-barcodes";

type VariantBarcodeRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function barcodeError(error: unknown) {
  if (error instanceof VariantBarcodeError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Failed to update variant barcode.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PUT(request: NextRequest, context: VariantBarcodeRouteContext) {
  const authorization = await authorizeAdminRequest(request, "labels:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("barcode_labels"))) return featureDisabledResponse("barcode_labels");

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      barcode?: unknown;
      force?: unknown;
      clientRequestId?: unknown;
    };

    const result = await updateVariantBarcode({
      variantId: id,
      barcode: typeof body.barcode === "string" ? body.barcode : "",
      force: body.force === true,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
      actor: adminActorFromContext(authorization.context),
    });

    return NextResponse.json({
      ok: true,
      updated: result.updated,
      noChange: result.noChange,
      variant: result.variant,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    return barcodeError(error);
  }
}
