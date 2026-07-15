export const PRODUCT_CSV_LIMITS = {
  maxFileBytes: 1 * 1024 * 1024,
  maxRows: 500,
  maxColumns: 100,
  maxCellChars: 32 * 1024,
  maxRowChars: 128 * 1024,
  maxImageUrls: 20,
  maxSizes: 100,
  maxJsonDepth: 8,
  maxJsonItems: 500,
  maxJsonStringChars: 4 * 1024,
} as const;

export type CsvInputErrorCode =
  | "CSV_FILE_TOO_LARGE"
  | "CSV_INVALID_UTF8"
  | "CSV_EMPTY_FILE"
  | "CSV_MALFORMED_QUOTES"
  | "CSV_TOO_MANY_ROWS"
  | "CSV_TOO_MANY_COLUMNS"
  | "CSV_CELL_TOO_LONG"
  | "CSV_ROW_TOO_LONG"
  | "CSV_DUPLICATE_HEADER"
  | "CSV_UNKNOWN_HEADER"
  | "CSV_MISSING_REQUIRED_HEADER"
  | "CSV_COLUMN_COUNT_MISMATCH"
  | "CSV_DUPLICATE_SKU"
  | "CSV_INVALID_NUMBER"
  | "CSV_NUMBER_OUT_OF_RANGE"
  | "CSV_INVALID_BOOLEAN"
  | "CSV_INVALID_SIZE_STOCK"
  | "CSV_INVALID_JSON"
  | "CSV_INVALID_JSON_SCHEMA"
  | "CSV_JSON_TOO_DEEP"
  | "CSV_JSON_TOO_MANY_ITEMS"
  | "CSV_JSON_STRING_TOO_LONG";

export class CsvInputError extends Error {
  readonly code: CsvInputErrorCode;
  readonly rowNumber?: number;
  readonly field?: string;

  constructor(
    code: CsvInputErrorCode,
    message: string,
    detail: { rowNumber?: number; field?: string } = {},
  ) {
    super(message);
    this.name = "CsvInputError";
    this.code = code;
    this.rowNumber = detail.rowNumber;
    this.field = detail.field;
  }
}

export async function readRequestBytesWithLimit(request: Request, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("request byte limit must be a positive safe integer");
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CsvInputError("CSV_FILE_TOO_LARGE", "Request body exceeds the configured limit.");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded");
        throw new CsvInputError("CSV_FILE_TOO_LARGE", "Request body exceeds the configured limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

type CsvParserLimits = Partial<{
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
  maxRowChars: number;
}>;

type ParseProductCsvOptions = {
  allowedHeaders: readonly string[];
  requiredHeaders: readonly string[];
  headerAliases?: Readonly<Record<string, string>>;
  importMode: "create_only" | "update_existing" | "upsert";
  inventoryMode: "metadata_only" | "set_inventory";
  limits?: CsvParserLimits;
};

type ParsedRecord = {
  rowNumber: number;
  cells: string[];
};

function mergeParserLimits(overrides: CsvParserLimits = {}) {
  return {
    maxFileBytes: overrides.maxFileBytes ?? PRODUCT_CSV_LIMITS.maxFileBytes,
    maxRows: overrides.maxRows ?? PRODUCT_CSV_LIMITS.maxRows,
    maxColumns: overrides.maxColumns ?? PRODUCT_CSV_LIMITS.maxColumns,
    maxCellChars: overrides.maxCellChars ?? PRODUCT_CSV_LIMITS.maxCellChars,
    maxRowChars: overrides.maxRowChars ?? PRODUCT_CSV_LIMITS.maxRowChars,
  };
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new CsvInputError("CSV_INVALID_UTF8", "CSV must be valid UTF-8 text.");
  }
}

function parseCsvRecords(text: string, limits: ReturnType<typeof mergeParserLimits>) {
  const records: ParsedRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "after_quote" = "plain";
  let line = 1;
  let recordStartLine = 1;
  let rowChars = 0;

  const append = (value: string) => {
    cell += value;
    rowChars += value.length;
    if (cell.length > limits.maxCellChars) {
      throw new CsvInputError("CSV_CELL_TOO_LONG", "A CSV cell exceeds the configured limit.", {
        rowNumber: recordStartLine,
      });
    }
    if (rowChars > limits.maxRowChars) {
      throw new CsvInputError("CSV_ROW_TOO_LONG", "A CSV row exceeds the configured limit.", {
        rowNumber: recordStartLine,
      });
    }
  };

  const finishCell = () => {
    cells.push(cell.trim());
    cell = "";
    if (cells.length > limits.maxColumns) {
      throw new CsvInputError("CSV_TOO_MANY_COLUMNS", "CSV contains too many columns.", {
        rowNumber: recordStartLine,
      });
    }
  };

  const finishRecord = () => {
    finishCell();
    if (cells.some((value) => value.length > 0)) {
      records.push({ rowNumber: recordStartLine, cells });
    }
    cells = [];
    rowChars = 0;
    recordStartLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];

    if (state === "quoted") {
      if (char === '"' && next === '"') {
        append('"');
        index += 1;
      } else if (char === '"') {
        state = "after_quote";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && next === "\n") index += 1;
        append("\n");
        line += 1;
      } else {
        append(char);
      }
      continue;
    }

    if (state === "after_quote") {
      if (char === " " || char === "\t") continue;
      if (char === ",") {
        finishCell();
        state = "plain";
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && next === "\n") index += 1;
        finishRecord();
        state = "plain";
        line += 1;
        continue;
      }
      throw new CsvInputError("CSV_MALFORMED_QUOTES", "Unexpected text after a closing CSV quote.", {
        rowNumber: recordStartLine,
      });
    }

    if (char === '"') {
      if (cell.length !== 0) {
        throw new CsvInputError("CSV_MALFORMED_QUOTES", "A CSV quote must begin a cell.", {
          rowNumber: recordStartLine,
        });
      }
      state = "quoted";
    } else if (char === ",") {
      finishCell();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && next === "\n") index += 1;
      finishRecord();
      line += 1;
    } else {
      append(char);
    }
  }

  if (state === "quoted") {
    throw new CsvInputError("CSV_MALFORMED_QUOTES", "CSV contains an unclosed quoted cell.", {
      rowNumber: recordStartLine,
    });
  }
  if (cells.length > 0 || cell.length > 0 || state === "after_quote") finishRecord();
  return records;
}

export function parseProductCsvBytes(bytes: Uint8Array, options: ParseProductCsvOptions) {
  const limits = mergeParserLimits(options.limits);
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new CsvInputError("CSV_FILE_TOO_LARGE", "CSV file exceeds the configured byte limit.");
  }
  const records = parseCsvRecords(decodeUtf8(bytes), limits);
  if (records.length === 0) {
    throw new CsvInputError("CSV_EMPTY_FILE", "CSV file is empty.");
  }

  const allowed = new Map(options.allowedHeaders.map((field) => [field.toLowerCase(), field]));
  const aliases = new Map(
    Object.entries(options.headerAliases || {}).map(([alias, field]) => [alias.trim().toLowerCase(), field]),
  );
  const canonicalHeaders: string[] = [];
  const seen = new Set<string>();
  for (const rawHeader of records[0]!.cells) {
    const lookup = rawHeader.trim().toLowerCase();
    const canonical = aliases.get(lookup) || allowed.get(lookup);
    if (!canonical || !allowed.has(canonical.toLowerCase())) {
      throw new CsvInputError("CSV_UNKNOWN_HEADER", `Unknown CSV header: ${rawHeader || "(empty)"}`);
    }
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      throw new CsvInputError("CSV_DUPLICATE_HEADER", `Duplicate CSV header: ${canonical}`);
    }
    seen.add(key);
    canonicalHeaders.push(allowed.get(key)!);
  }
  if (canonicalHeaders.length > limits.maxColumns) {
    throw new CsvInputError("CSV_TOO_MANY_COLUMNS", "CSV contains too many columns.");
  }
  const missing = options.requiredHeaders.filter((field) => !seen.has(field.toLowerCase()));
  if (missing.length > 0) {
    throw new CsvInputError(
      "CSV_MISSING_REQUIRED_HEADER",
      `CSV is missing required headers: ${missing.join(", ")}`,
    );
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > limits.maxRows) {
    throw new CsvInputError("CSV_TOO_MANY_ROWS", "CSV contains too many data rows.");
  }
  const normalizedSkus = new Set<string>();
  const rows = dataRecords.map((record) => {
    if (record.cells.length !== canonicalHeaders.length) {
      throw new CsvInputError(
        "CSV_COLUMN_COUNT_MISMATCH",
        `CSV row ${record.rowNumber} has ${record.cells.length} cells; expected ${canonicalHeaders.length}.`,
        { rowNumber: record.rowNumber },
      );
    }
    const values = Object.fromEntries(canonicalHeaders.map((field, index) => [field, record.cells[index] ?? ""]));
    const normalizedSku = String(values.sku || "").trim().toLowerCase();
    if (normalizedSku && normalizedSkus.has(normalizedSku)) {
      throw new CsvInputError("CSV_DUPLICATE_SKU", `Duplicate normalized SKU: ${normalizedSku}`, {
        rowNumber: record.rowNumber,
        field: "sku",
      });
    }
    if (normalizedSku) normalizedSkus.add(normalizedSku);
    return { rowNumber: record.rowNumber, normalizedSku, values };
  });

  return {
    headers: canonicalHeaders,
    rows,
    importMode: options.importMode,
    inventoryMode: options.inventoryMode,
    byteLength: bytes.byteLength,
  };
}

export function parseStrictCsvNumber(
  value: unknown,
  options: { field: string; integer?: boolean; min?: number; max?: number },
) {
  const text = String(value ?? "").trim();
  if (!/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(text)) {
    throw new CsvInputError("CSV_INVALID_NUMBER", `${options.field} must be a complete number.`, {
      field: options.field,
    });
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || (options.integer && !Number.isInteger(parsed))) {
    throw new CsvInputError("CSV_INVALID_NUMBER", `${options.field} has an invalid numeric value.`, {
      field: options.field,
    });
  }
  if ((options.min !== undefined && parsed < options.min) || (options.max !== undefined && parsed > options.max)) {
    throw new CsvInputError("CSV_NUMBER_OUT_OF_RANGE", `${options.field} is outside the allowed range.`, {
      field: options.field,
    });
  }
  return parsed;
}

export function parseStrictCsvBoolean(value: unknown, options: { field: string }) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  throw new CsvInputError("CSV_INVALID_BOOLEAN", `${options.field} must be true/false, 1/0, or yes/no.`, {
    field: options.field,
  });
}

export function parseStrictSizeStock(
  value: unknown,
  options: { sizes?: string[]; maxQuantity?: number } = {},
) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new CsvInputError("CSV_INVALID_SIZE_STOCK", "size_stock cannot be empty.", { field: "size_stock" });
  }
  const declared = options.sizes?.map((size) => size.trim().toUpperCase()).filter(Boolean);
  const declaredSet = declared ? new Set(declared) : null;
  const result: Record<string, number> = {};
  for (const token of text.split(",")) {
    const pieces = token.split(":");
    if (pieces.length !== 2) {
      throw new CsvInputError("CSV_INVALID_SIZE_STOCK", "Every size_stock token must use SIZE:QUANTITY.", { field: "size_stock" });
    }
    const size = pieces[0]!.trim().toUpperCase();
    if (!size || Object.prototype.hasOwnProperty.call(result, size) || (declaredSet && !declaredSet.has(size))) {
      throw new CsvInputError("CSV_INVALID_SIZE_STOCK", "size_stock contains an empty, duplicate, or undeclared size.", { field: "size_stock" });
    }
    result[size] = parseStrictCsvNumber(pieces[1], {
      field: `size_stock.${size}`,
      integer: true,
      min: 0,
      max: options.maxQuantity ?? 1_000_000,
    });
  }
  if (declared && declared.some((size) => !Object.prototype.hasOwnProperty.call(result, size))) {
    throw new CsvInputError("CSV_INVALID_SIZE_STOCK", "Every declared size requires an explicit quantity.", { field: "size_stock" });
  }
  return result;
}

type StrictJsonOptions = {
  field: string;
  schema: "object" | "string_array";
  maxDepth?: number;
  maxItems?: number;
  maxStringChars?: number;
};

export function parseStrictCsvJson(value: unknown, options: StrictJsonOptions) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new CsvInputError("CSV_INVALID_JSON", `${options.field} must contain valid JSON.`, { field: options.field });
  }
  if (options.schema === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", `${options.field} must be a JSON object.`, { field: options.field });
  }
  if (options.schema === "string_array" && (
    !Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")
  )) {
    throw new CsvInputError("CSV_INVALID_JSON_SCHEMA", `${options.field} must be an array of strings.`, { field: options.field });
  }

  const maxDepth = options.maxDepth ?? PRODUCT_CSV_LIMITS.maxJsonDepth;
  const maxItems = options.maxItems ?? PRODUCT_CSV_LIMITS.maxJsonItems;
  const maxStringChars = options.maxStringChars ?? PRODUCT_CSV_LIMITS.maxJsonStringChars;
  let items = 0;
  const inspect = (child: unknown, depth: number) => {
    if (depth > maxDepth) {
      throw new CsvInputError("CSV_JSON_TOO_DEEP", `${options.field} exceeds the JSON depth limit.`, { field: options.field });
    }
    if (typeof child === "string" && child.length > maxStringChars) {
      throw new CsvInputError("CSV_JSON_STRING_TOO_LONG", `${options.field} contains an overlong string.`, { field: options.field });
    }
    if (Array.isArray(child)) {
      items += child.length;
      if (items > maxItems) throw new CsvInputError("CSV_JSON_TOO_MANY_ITEMS", `${options.field} has too many items.`, { field: options.field });
      child.forEach((item) => inspect(item, depth + 1));
    } else if (child && typeof child === "object") {
      const values = Object.values(child as Record<string, unknown>);
      items += values.length;
      if (items > maxItems) throw new CsvInputError("CSV_JSON_TOO_MANY_ITEMS", `${options.field} has too many entries.`, { field: options.field });
      values.forEach((item) => inspect(item, depth + 1));
    }
  };
  inspect(parsed, 1);
  return parsed;
}
