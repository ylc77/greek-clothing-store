export type PosOperationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredOperation = {
  id: string;
  fingerprint: string;
};

const storagePrefix = "clothing-store:pos-operation:";

function defaultIdFactory() {
  return globalThis.crypto.randomUUID();
}

export class PosOperationIdStore {
  private readonly memory = new Map<string, StoredOperation>();
  private readonly storage: PosOperationStorage;
  private readonly createId: () => string;

  constructor(
    storage: PosOperationStorage,
    createId: () => string = defaultIdFactory,
  ) {
    this.storage = storage;
    this.createId = createId;
  }

  private storageKey(scope: string) {
    return `${storagePrefix}${encodeURIComponent(scope)}`;
  }

  private read(scope: string): StoredOperation | null {
    const memoryValue = this.memory.get(scope);
    if (memoryValue) return memoryValue;
    try {
      const raw = this.storage.getItem(this.storageKey(scope));
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<StoredOperation>;
      if (typeof value.id !== "string" || !value.id || typeof value.fingerprint !== "string") return null;
      const operation = { id: value.id, fingerprint: value.fingerprint };
      this.memory.set(scope, operation);
      return operation;
    } catch {
      return null;
    }
  }

  private write(scope: string, operation: StoredOperation) {
    this.memory.set(scope, operation);
    try {
      this.storage.setItem(this.storageKey(scope), JSON.stringify(operation));
    } catch {
      // The in-memory copy still protects repeated clicks in this page session.
    }
  }

  getOrCreate(scope: string, fingerprint: string) {
    const current = this.read(scope);
    if (current?.fingerprint === fingerprint) return current.id;
    const operation = { id: this.createId(), fingerprint };
    this.write(scope, operation);
    return operation.id;
  }

  markUncertain(scope: string, id: string) {
    const current = this.read(scope);
    if (current?.id === id) this.write(scope, current);
  }

  complete(scope: string, id: string) {
    const current = this.read(scope);
    if (current?.id !== id) return;
    this.cancel(scope);
  }

  cancel(scope: string) {
    this.memory.delete(scope);
    try {
      this.storage.removeItem(this.storageKey(scope));
    } catch {
      // No persisted value can be removed when browser storage is unavailable.
    }
  }
}
