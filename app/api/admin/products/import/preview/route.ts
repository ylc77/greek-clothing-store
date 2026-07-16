import { NextRequest, NextResponse } from "next/server";
import {
  adminHasPermission,
  getAdminAuthContextFromRequest,
} from "@/lib/admin-auth";
import {
  publicImportRow,
  readProductCsvFormData,
} from "@/lib/csv-import-server";
import { CsvInputError } from "@/lib/csv-parser";
import { featureDisabledResponse, isFeatureEnabledUncached } from "@/lib/features";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!adminHasPermission(context, "products:write")) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  if (!(await isFeatureEnabledUncached("csv_import"))) return featureDisabledResponse("csv_import");

  try {
    const form = await readProductCsvFormData(request);
    return NextResponse.json({
      filename: form.filename,
      fileHash: form.fileHash,
      byteLength: form.bytes.byteLength,
      importMode: form.importMode,
      inventoryMode: form.inventoryMode,
      headers: form.parsed.headers,
      rowCount: form.parsed.rows.length,
      rows: form.parsed.rows.slice(0, 100).map(publicImportRow),
      previewTruncated: form.parsed.rows.length > 100,
      operationSafeToDiscard: true,
    });
  } catch (error) {
    if (error instanceof CsvInputError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          rowNumber: error.rowNumber,
          field: error.field,
          operationSafeToDiscard: true,
        },
        { status: error.code === "CSV_FILE_TOO_LARGE" ? 413 : 400 },
      );
    }
    return NextResponse.json(
      { error: "CSV preview could not be generated.", code: "CSV_PREVIEW_FAILED", operationSafeToDiscard: true },
      { status: 400 },
    );
  }
}
