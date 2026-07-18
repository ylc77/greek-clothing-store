export const MAX_BULK_BARCODE_VARIANTS = 100;
const MAX_RAW_VARIANT_IDS = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set(["variantIds", "clientRequestId", "mode"]);

export class BarcodeBulkRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code = "BARCODE_INVALID_ARGUMENT", status = 400) {
    super(message);
    this.name = "BarcodeBulkRequestError";
    this.code = code;
    this.status = status;
  }
}

export function parseBulkBarcodeRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BarcodeBulkRequestError("Request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new BarcodeBulkRequestError("Request contains unsupported fields.");
  }
  if (!Array.isArray(body.variantIds) || body.variantIds.length === 0) {
    throw new BarcodeBulkRequestError("variantIds must contain at least one Variant ID.");
  }
  if (body.variantIds.length > MAX_RAW_VARIANT_IDS) {
    throw new BarcodeBulkRequestError("variantIds contains too many entries.", "BARCODE_BATCH_TOO_LARGE", 413);
  }
  if (body.variantIds.some((item) => typeof item !== "string" || !UUID_PATTERN.test(item.trim()))) {
    throw new BarcodeBulkRequestError("Every Variant ID must be a UUID.");
  }
  const variantIds = Array.from(new Set((body.variantIds as string[]).map((item) => item.trim().toLowerCase()))).sort();
  if (variantIds.length > MAX_BULK_BARCODE_VARIANTS) {
    throw new BarcodeBulkRequestError(
      `A maximum of ${MAX_BULK_BARCODE_VARIANTS} Variants can be processed at once.`,
      "BARCODE_BATCH_TOO_LARGE",
      413,
    );
  }
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
  if (!clientRequestId || clientRequestId.length > 200) {
    throw new BarcodeBulkRequestError("clientRequestId is required and must not exceed 200 characters.");
  }
  const mode = body.mode === undefined ? "variant_sku" : body.mode;
  if (mode !== "variant_sku") {
    throw new BarcodeBulkRequestError('Only mode "variant_sku" is supported.');
  }
  return { variantIds, clientRequestId, mode: "variant_sku" as const };
}
