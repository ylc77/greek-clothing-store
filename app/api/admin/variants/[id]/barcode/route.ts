import { NextRequest, NextResponse } from "next/server";
import { adminPasswordIsValid } from "@/lib/admin-products";
import { updateVariantBarcode, VariantBarcodeError } from "@/lib/variant-barcodes";

type VariantBarcodeRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function barcodeError(error: unknown) {
  if (error instanceof VariantBarcodeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Failed to update variant barcode.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PUT(request: NextRequest, context: VariantBarcodeRouteContext) {
  if (!adminPasswordIsValid(request.headers.get("x-admin-password"))) return unauthorized();

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      barcode?: unknown;
      force?: unknown;
    };

    const result = await updateVariantBarcode({
      variantId: id,
      barcode: typeof body.barcode === "string" ? body.barcode : "",
      force: body.force === true,
    });

    return NextResponse.json({
      ok: true,
      updated: result.updated,
      noChange: result.noChange,
      variant: result.variant,
    });
  } catch (error) {
    return barcodeError(error);
  }
}
