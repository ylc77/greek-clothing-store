export type StorageReconciliationInput = {
  objectPaths: Iterable<string>;
  referencedPaths: Iterable<string>;
  pendingCleanupPaths?: Iterable<string>;
};

export type StorageReconciliationReport = {
  orphanPaths: string[];
  missingObjectPaths: string[];
  pendingCleanupPaths: string[];
  mutated: false;
};

function normalizedSet(values: Iterable<string> | undefined) {
  return new Set(Array.from(values || []).map((value) => value.trim()).filter(Boolean));
}
export function reconcileStorageInventory(input: StorageReconciliationInput): StorageReconciliationReport {
  const objects = normalizedSet(input.objectPaths);
  const references = normalizedSet(input.referencedPaths);
  const pending = normalizedSet(input.pendingCleanupPaths);
  return {
    orphanPaths: Array.from(objects).filter((path) => !references.has(path)).sort(),
    missingObjectPaths: Array.from(references).filter((path) => !objects.has(path)).sort(),
    pendingCleanupPaths: Array.from(pending).sort(),
    mutated: false,
  };
}
