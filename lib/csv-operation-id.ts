export type CsvImportOperationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type CsvImportOperationStateErrorCode =
  | "OPERATION_STORAGE_UNAVAILABLE"
  | "OPERATION_STATE_CORRUPT"
  | "OPERATION_PENDING_DIFFERENT_INPUT";

export class CsvImportOperationStateError extends Error {
  readonly code: CsvImportOperationStateErrorCode;

  constructor(code: CsvImportOperationStateErrorCode, message: string) {
    super(message);
    this.name = "CsvImportOperationStateError";
    this.code = code;
  }
}

type StoredCsvImportOperation = {
  operationId: string;
  fingerprint: string;
  jobId: string | null;
  createdAt: number;
  attemptedAt: number | null;
};

type CsvImportOperationIdStoreOptions = {
  createId?: () => string;
  now?: () => number;
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function createCsvImportFingerprint(payload: unknown) {
  const serialized = JSON.stringify(canonicalize(payload));
  if (typeof serialized !== "string") {
    throw new TypeError("CSV import payload must be JSON serializable");
  }
  return serialized;
}

export class CsvImportOperationIdStore {
  private readonly namespace: string;
  private readonly storage: CsvImportOperationStorage;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    namespace: string,
    storage: CsvImportOperationStorage,
    options: CsvImportOperationIdStoreOptions = {},
  ) {
    this.namespace = namespace;
    this.storage = storage;
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  storageKeyForTest() {
    return `clothing-store:${encodeURIComponent(this.namespace)}-import-operation`;
  }

  private read() {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKeyForTest());
    } catch {
      throw new CsvImportOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "Browser storage is unavailable, so CSV import is blocked before writing.",
      );
    }
    if (!raw) return null;

    let value: Partial<StoredCsvImportOperation>;
    try {
      value = JSON.parse(raw) as Partial<StoredCsvImportOperation>;
    } catch {
      throw new CsvImportOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "The saved CSV import operation is corrupt. Reconcile it before starting another import.",
      );
    }
    if (
      typeof value.operationId !== "string"
      || !value.operationId
      || typeof value.fingerprint !== "string"
      || !value.fingerprint
      || (value.jobId !== null && typeof value.jobId !== "string")
      || typeof value.createdAt !== "number"
      || !Number.isFinite(value.createdAt)
      || (value.attemptedAt !== null && (
        typeof value.attemptedAt !== "number" || !Number.isFinite(value.attemptedAt)
      ))
    ) {
      throw new CsvImportOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "The saved CSV import operation is incomplete. Reconcile it before starting another import.",
      );
    }
    // A submitted CSV operation is backed by a persistent server Job and must
    // remain recoverable by operationId/jobId even after the local TTL. Only an
    // operation that was never sent may age out and be replaced safely.
    if (this.now() - value.createdAt > this.ttlMs && value.attemptedAt === null) return null;
    return value as StoredCsvImportOperation;
  }

  private write(operation: StoredCsvImportOperation) {
    const serialized = JSON.stringify(operation);
    try {
      this.storage.setItem(this.storageKeyForTest(), serialized);
      if (this.storage.getItem(this.storageKeyForTest()) !== serialized) {
        throw new Error("storage verification failed");
      }
    } catch {
      throw new CsvImportOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "Browser storage cannot preserve the CSV business ID, so import is blocked.",
      );
    }
  }

  getPending() {
    const current = this.read();
    if (!current) return null;
    return {
      operationId: current.operationId,
      fingerprint: current.fingerprint,
      jobId: current.jobId,
      attempted: current.attemptedAt !== null,
    };
  }

  getOrCreate(fingerprint: string) {
    if (!fingerprint) throw new TypeError("CSV import fingerprint is required");
    const current = this.read();
    if (current?.fingerprint === fingerprint) return current.operationId;
    if (current?.attemptedAt !== null && current) {
      throw new CsvImportOperationStateError(
        "OPERATION_PENDING_DIFFERENT_INPUT",
        "A prior CSV import may have written data. Recover or cancel it before selecting different content.",
      );
    }
    const next: StoredCsvImportOperation = {
      operationId: this.createId(),
      fingerprint,
      jobId: null,
      createdAt: this.now(),
      attemptedAt: null,
    };
    this.write(next);
    return next.operationId;
  }

  markAttempt(operationId: string) {
    const current = this.read();
    if (!current || current.operationId !== operationId) return;
    this.write({ ...current, attemptedAt: current.attemptedAt ?? this.now() });
  }

  attachJob(operationId: string, jobId: string) {
    const current = this.read();
    if (!current || current.operationId !== operationId) return;
    this.write({ ...current, jobId });
  }

  private clear(operationId?: string) {
    if (operationId) {
      const current = this.read();
      if (!current || current.operationId !== operationId) return;
    }
    try {
      this.storage.removeItem(this.storageKeyForTest());
    } catch {
      throw new CsvImportOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "The completed CSV import operation could not be cleared. Reconcile before retrying.",
      );
    }
  }

  complete(operationId: string) {
    this.clear(operationId);
  }

  discardKnownNoWrite(operationId: string) {
    this.clear(operationId);
  }

  cancel() {
    this.clear();
  }
}
