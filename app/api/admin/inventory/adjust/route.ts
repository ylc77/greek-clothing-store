import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { adjustInventoryVariant } from "@/lib/erp-inventory";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  if (!(await adminRequestHasPermissionAsync(request, "inventory:write"))) return unauthorized();

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const variantId = typeof payload.variantId === "string" ? payload.variantId : "";
  const mode = payload.mode === "set_to" || payload.mode === "adjust_by" ? payload.mode : null;
  const quantity = Number(payload.quantity);
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const clientRequestId = typeof payload.clientRequestId === "string" ? payload.clientRequestId : "";

  if (!variantId.trim()) {
    return NextResponse.json({ error: "variantId is required." }, { status: 400 });
  }
  if (!mode) {
    return NextResponse.json({ error: "mode must be set_to or adjust_by." }, { status: 400 });
  }
  if (!Number.isInteger(quantity)) {
    return NextResponse.json({ error: "quantity must be an integer." }, { status: 400 });
  }
  if (!reason.trim()) {
    return NextResponse.json({ error: "reason is required." }, { status: 400 });
  }
  if (!clientRequestId.trim()) {
    return NextResponse.json({ error: "clientRequestId is required." }, { status: 400 });
  }

  try {
    const result = await adjustInventoryVariant({
      variantId,
      mode,
      quantity,
      reason,
      clientRequestId,
      createdBy: "admin",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to adjust inventory.";
    const status = message.includes("negative") || message.includes("required") || message.includes("integer") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
