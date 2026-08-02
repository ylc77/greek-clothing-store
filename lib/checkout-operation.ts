type StoredCheckoutOperation = { id: string; accessToken: string; fingerprint: string };
const KEY = "clothing-store:checkout-operation:v1";

function randomToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class CheckoutOperationStore {
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    this.storage = storage;
  }

  getOrCreate(fingerprint: string): StoredCheckoutOperation {
    try {
      const current = JSON.parse(this.storage.getItem(KEY) || "null") as Partial<StoredCheckoutOperation> | null;
      if (current?.fingerprint === fingerprint && typeof current.id === "string" && typeof current.accessToken === "string") return current as StoredCheckoutOperation;
    } catch { /* replace invalid state */ }
    const operation = { id: globalThis.crypto.randomUUID(), accessToken: randomToken(), fingerprint };
    this.storage.setItem(KEY, JSON.stringify(operation));
    return operation;
  }

  complete(id: string) {
    try {
      const current = JSON.parse(this.storage.getItem(KEY) || "null") as Partial<StoredCheckoutOperation> | null;
      if (current?.id === id) this.storage.removeItem(KEY);
    } catch { this.storage.removeItem(KEY); }
  }
}
