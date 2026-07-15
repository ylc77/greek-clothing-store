export type ProductOperationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ProductOperationStateErrorCode =
  | "OPERATION_STORAGE_UNAVAILABLE"
  | "OPERATION_STATE_CORRUPT"
  | "OPERATION_EXPIRED_UNKNOWN"
  | "OPERATION_PENDING_DIFFERENT_INPUT";

export class ProductOperationStateError extends Error {
  readonly code: ProductOperationStateErrorCode;

  constructor(code: ProductOperationStateErrorCode, message: string) {
    super(message);
    this.name = "ProductOperationStateError";
    this.code = code;
  }
}

type StoredProductOperation = {
  id: string;
  fingerprint: string;
  createdAt: number;
  attemptedAt: number | null;
};

type ProductOperationIdStoreOptions = {
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
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/**
 * Produces a deterministic representation of the business payload. Object keys
 * are recursively sorted while array order is preserved because it may carry
 * business meaning (for example, the configured display order of sizes).
 */
export function createProductOperationFingerprint(payload: unknown): string {
  const serialized = JSON.stringify(canonicalize(payload));
  if (typeof serialized !== "string") {
    throw new TypeError("Product operation payload must be JSON serializable");
  }
  return serialized;
}

export class ProductOperationIdStore {
  private readonly namespace: string;
  private readonly storage: ProductOperationStorage;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    namespace: string,
    storage: ProductOperationStorage,
    options: ProductOperationIdStoreOptions = {},
  ) {
    this.namespace = namespace;
    this.storage = storage;
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  storageKeyForTest(scope: string) {
    return `clothing-store:${encodeURIComponent(this.namespace)}-operation:${encodeURIComponent(scope)}`;
  }

  private read(scope: string): StoredProductOperation | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKeyForTest(scope));
    } catch {
      throw new ProductOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法读取安全操作状态，商品写入已阻止。请启用 sessionStorage 后重试。",
      );
    }
    if (!raw) return null;

    let value: Partial<StoredProductOperation>;
    try {
      value = JSON.parse(raw) as Partial<StoredProductOperation>;
    } catch {
      throw new ProductOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "商品操作状态损坏。请先取消当前操作，再重新开始。",
      );
    }
    if (
      typeof value.id !== "string"
      || !value.id
      || typeof value.fingerprint !== "string"
      || typeof value.createdAt !== "number"
      || !Number.isFinite(value.createdAt)
      || (value.attemptedAt !== null && (
        typeof value.attemptedAt !== "number" || !Number.isFinite(value.attemptedAt)
      ))
    ) {
      throw new ProductOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "商品操作状态不完整。请先取消当前操作，再重新开始。",
      );
    }
    if (this.now() - value.createdAt > this.ttlMs) {
      throw new ProductOperationStateError(
        "OPERATION_EXPIRED_UNKNOWN",
        "该商品操作已超过安全重试期限，结果可能未知。请先核对商品和库存流水，再取消并开始新操作。",
      );
    }
    return value as StoredProductOperation;
  }

  private write(scope: string, operation: StoredProductOperation) {
    const key = this.storageKeyForTest(scope);
    const serialized = JSON.stringify(operation);
    try {
      this.storage.setItem(key, serialized);
      if (this.storage.getItem(key) !== serialized) throw new Error("storage verification failed");
    } catch {
      throw new ProductOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法持久保存业务 ID，商品写入已阻止。请启用 sessionStorage 后重试。",
      );
    }
  }

  getOrCreate(scope: string, fingerprint: string) {
    const current = this.read(scope);
    if (current?.fingerprint === fingerprint) return current.id;
    if (current?.attemptedAt) {
      throw new ProductOperationStateError(
        "OPERATION_PENDING_DIFFERENT_INPUT",
        "上一笔商品操作结果仍未确认。请先核对或取消上一笔操作，再提交新的内容。",
      );
    }
    const operation: StoredProductOperation = {
      id: this.createId(),
      fingerprint,
      createdAt: this.now(),
      attemptedAt: null,
    };
    this.write(scope, operation);
    return operation.id;
  }

  markAttempt(scope: string, id: string) {
    const current = this.read(scope);
    if (!current || current.id !== id) return;
    this.write(scope, { ...current, attemptedAt: current.attemptedAt ?? this.now() });
  }

  private clear(scope: string, id?: string) {
    if (id) {
      const current = this.read(scope);
      if (!current || current.id !== id) return;
    }
    try {
      this.storage.removeItem(this.storageKeyForTest(scope));
    } catch {
      throw new ProductOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法清除已完成的商品操作状态，请刷新后核对商品和库存流水。",
      );
    }
  }

  complete(scope: string, id: string) {
    this.clear(scope, id);
  }

  discardKnownNoWrite(scope: string, id: string) {
    this.clear(scope, id);
  }

  cancel(scope: string) {
    this.clear(scope);
  }
}
