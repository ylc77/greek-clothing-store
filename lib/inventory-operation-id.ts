export type InventoryOperationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InventoryOperationStateErrorCode =
  | "OPERATION_STORAGE_UNAVAILABLE"
  | "OPERATION_STATE_CORRUPT"
  | "OPERATION_EXPIRED_UNKNOWN"
  | "OPERATION_PENDING_DIFFERENT_INPUT";

export class InventoryOperationStateError extends Error {
  readonly code: InventoryOperationStateErrorCode;

  constructor(code: InventoryOperationStateErrorCode, message: string) {
    super(message);
    this.name = "InventoryOperationStateError";
    this.code = code;
  }
}

type StoredInventoryOperation = {
  id: string;
  fingerprint: string;
  createdAt: number;
  attemptedAt: number | null;
};

type InventoryOperationIdStoreOptions = {
  createId?: () => string;
  now?: () => number;
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class InventoryOperationIdStore {
  private readonly namespace: string;
  private readonly storage: InventoryOperationStorage;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    namespace: string,
    storage: InventoryOperationStorage,
    options: InventoryOperationIdStoreOptions = {},
  ) {
    this.namespace = namespace;
    this.storage = storage;
    this.createId = options.createId || (() => globalThis.crypto.randomUUID());
    this.now = options.now || (() => Date.now());
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  }

  storageKeyForTest(scope: string) {
    return `clothing-store:${encodeURIComponent(this.namespace)}-operation:${encodeURIComponent(scope)}`;
  }

  private read(scope: string): StoredInventoryOperation | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKeyForTest(scope));
    } catch {
      throw new InventoryOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法读取安全操作状态，库存写入已阻止。请启用 sessionStorage 后重试。",
      );
    }
    if (!raw) return null;

    let value: Partial<StoredInventoryOperation>;
    try {
      value = JSON.parse(raw) as Partial<StoredInventoryOperation>;
    } catch {
      throw new InventoryOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "库存操作状态损坏。请先取消当前操作，再重新开始。",
      );
    }
    if (
      typeof value.id !== "string"
      || !value.id
      || typeof value.fingerprint !== "string"
      || typeof value.createdAt !== "number"
      || (value.attemptedAt !== null && typeof value.attemptedAt !== "number")
    ) {
      throw new InventoryOperationStateError(
        "OPERATION_STATE_CORRUPT",
        "库存操作状态不完整。请先取消当前操作，再重新开始。",
      );
    }
    if (this.now() - value.createdAt > this.ttlMs) {
      throw new InventoryOperationStateError(
        "OPERATION_EXPIRED_UNKNOWN",
        "该库存操作已超过安全重试期限，结果可能未知。请先核对库存流水，再取消并开始新操作。",
      );
    }
    return value as StoredInventoryOperation;
  }

  private write(scope: string, operation: StoredInventoryOperation) {
    const key = this.storageKeyForTest(scope);
    const serialized = JSON.stringify(operation);
    try {
      this.storage.setItem(key, serialized);
      if (this.storage.getItem(key) !== serialized) throw new Error("storage verification failed");
    } catch {
      throw new InventoryOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法持久保存业务 ID，库存写入已阻止。请启用 sessionStorage 后重试。",
      );
    }
  }

  getOrCreate(scope: string, fingerprint: string) {
    const current = this.read(scope);
    if (current?.fingerprint === fingerprint) return current.id;
    if (current?.attemptedAt) {
      throw new InventoryOperationStateError(
        "OPERATION_PENDING_DIFFERENT_INPUT",
        "上一笔库存操作结果仍未确认。请先核对或取消上一笔操作，再提交新的内容。",
      );
    }
    const operation: StoredInventoryOperation = {
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
    this.write(scope, { ...current, attemptedAt: current.attemptedAt || this.now() });
  }

  private clear(scope: string, id?: string) {
    if (id) {
      const current = this.read(scope);
      if (!current || current.id !== id) return;
    }
    try {
      this.storage.removeItem(this.storageKeyForTest(scope));
    } catch {
      throw new InventoryOperationStateError(
        "OPERATION_STORAGE_UNAVAILABLE",
        "浏览器无法清除已完成的操作状态，请刷新后核对库存流水。",
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
