import type { getSupabaseAdminClient } from "./supabase";

type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export type StorageOperationStatus =
  | "prepared"
  | "storage_ready"
  | "reference_committed"
  | "reference_removed"
  | "cleanup_pending"
  | "completed"
  | "compensated"
  | "failed"
  | "cancelled";

export type StorageOperationInput = {
  operationId: string;
  action: "upload" | "delete" | "product_delete";
  bucket: string;
  path: string;
  ownerType: "product" | "business_settings" | "category";
  ownerKey: string;
  reason?: string;
};

export type StorageLifecycleBackend = {
  prepare(input: StorageOperationInput): Promise<{ id: string }>;
  setStatus(id: string, status: StorageOperationStatus, error?: string): Promise<void>;
  upload(input: { bucket: string; path: string; body: Buffer; contentType: string }): Promise<void>;
  remove(path: string, bucket?: string): Promise<void>;
};

export class StorageLifecycleError extends Error {
  readonly code: "TRACKING_UNAVAILABLE" | "UPLOAD_FAILED" | "REFERENCE_FAILED" | "DELETE_FAILED";
  readonly cleanupPending: boolean;

  constructor(
    code: "TRACKING_UNAVAILABLE" | "UPLOAD_FAILED" | "REFERENCE_FAILED" | "DELETE_FAILED",
    message: string,
    cleanupPending = false,
  ) {
    super(message);
    this.name = "StorageLifecycleError";
    this.code = code;
    this.cleanupPending = cleanupPending;
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown storage lifecycle error");
}

async function markBestEffort(
  backend: StorageLifecycleBackend,
  id: string,
  status: StorageOperationStatus,
  error?: unknown,
) {
  try {
    await backend.setStatus(id, status, error === undefined ? undefined : message(error));
    return true;
  } catch {
    return false;
  }
}

export async function uploadAndCommitStorageObject(input: {
  backend: StorageLifecycleBackend;
  object: Omit<StorageOperationInput, "action">;
  body: Buffer;
  contentType: string;
  commitReference: () => Promise<void>;
}) {
  let operation: { id: string };
  try {
    operation = await input.backend.prepare({ ...input.object, action: "upload" });
  } catch (error) {
    throw new StorageLifecycleError("TRACKING_UNAVAILABLE", `Storage operation tracking is unavailable: ${message(error)}`);
  }

  try {
    await input.backend.upload({
      bucket: input.object.bucket,
      path: input.object.path,
      body: input.body,
      contentType: input.contentType,
    });
  } catch (error) {
    await markBestEffort(input.backend, operation.id, "failed", error);
    throw new StorageLifecycleError("UPLOAD_FAILED", `Image upload failed: ${message(error)}`);
  }

  const trackedReady = await markBestEffort(input.backend, operation.id, "storage_ready");
  if (!trackedReady) {
    try {
      await input.backend.remove(input.object.path, input.object.bucket);
    } catch {
      // The prepared row remains a durable reconciliation hint.
    }
    throw new StorageLifecycleError("TRACKING_UNAVAILABLE", "Uploaded object could not be tracked safely.", true);
  }

  try {
    await input.commitReference();
  } catch (error) {
    await markBestEffort(input.backend, operation.id, "cleanup_pending", error);
    try {
      await input.backend.remove(input.object.path, input.object.bucket);
      await markBestEffort(input.backend, operation.id, "compensated");
      throw new StorageLifecycleError("REFERENCE_FAILED", `Database reference update failed and the upload was removed: ${message(error)}`);
    } catch (cleanupError) {
      if (cleanupError instanceof StorageLifecycleError) throw cleanupError;
      await markBestEffort(input.backend, operation.id, "cleanup_pending", cleanupError);
      throw new StorageLifecycleError(
        "REFERENCE_FAILED",
        `Database reference update failed; uploaded object is queued for cleanup: ${message(error)}`,
        true,
      );
    }
  }

  await markBestEffort(input.backend, operation.id, "reference_committed");
  return { operationId: operation.id };
}

export async function detachAndDeleteStorageObject(input: {
  backend: StorageLifecycleBackend;
  object: Omit<StorageOperationInput, "action">;
  removeReference: () => Promise<void>;
}) {
  let operation: { id: string };
  try {
    operation = await input.backend.prepare({ ...input.object, action: "delete" });
  } catch (error) {
    throw new StorageLifecycleError("TRACKING_UNAVAILABLE", `Storage deletion could not be prepared: ${message(error)}`);
  }

  try {
    await input.removeReference();
  } catch (error) {
    await markBestEffort(input.backend, operation.id, "cancelled", error);
    throw new StorageLifecycleError("REFERENCE_FAILED", `Database reference was not removed: ${message(error)}`);
  }

  await markBestEffort(input.backend, operation.id, "reference_removed");
  try {
    await input.backend.remove(input.object.path, input.object.bucket);
    await markBestEffort(input.backend, operation.id, "completed");
    return { operationId: operation.id, cleanupPending: false };
  } catch (error) {
    await markBestEffort(input.backend, operation.id, "cleanup_pending", error);
    return { operationId: operation.id, cleanupPending: true };
  }
}

export async function queueStorageObjectDeletion(input: {
  backend: StorageLifecycleBackend;
  object: Omit<StorageOperationInput, "action">;
}) {
  let operation: { id: string };
  try {
    operation = await input.backend.prepare({ ...input.object, action: "delete" });
  } catch (error) {
    throw new StorageLifecycleError("TRACKING_UNAVAILABLE", `Storage cleanup could not be queued: ${message(error)}`);
  }
  await markBestEffort(input.backend, operation.id, "reference_removed");
  try {
    await input.backend.remove(input.object.path, input.object.bucket);
    await markBestEffort(input.backend, operation.id, "completed");
    return { operationId: operation.id, cleanupPending: false };
  } catch (error) {
    await markBestEffort(input.backend, operation.id, "cleanup_pending", error);
    return { operationId: operation.id, cleanupPending: true };
  }
}

export async function completePreparedStorageDeletion(input: {
  backend: StorageLifecycleBackend;
  operationRowId: string;
  bucket: string;
  path: string;
}) {
  try {
    await input.backend.remove(input.path, input.bucket);
    await markBestEffort(input.backend, input.operationRowId, "completed");
    return { cleanupPending: false };
  } catch (error) {
    await markBestEffort(input.backend, input.operationRowId, "cleanup_pending", error);
    return { cleanupPending: true };
  }
}

export function createSupabaseStorageLifecycleBackend(supabase: SupabaseAdminClient): StorageLifecycleBackend {
  // The repository keeps a deliberately narrow generated Database type for
  // products; this private service-role table is guarded by migration tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  return {
    async prepare(input) {
      const { data, error } = await db
        .from("storage_object_operations")
        .insert({
          client_operation_id: input.operationId,
          action: input.action,
          status: "prepared",
          bucket_id: input.bucket,
          object_path: input.path,
          owner_type: input.ownerType,
          owner_key: input.ownerKey,
          reason: input.reason || null,
        })
        .select("id")
        .single();
      if (error || !data?.id) throw new Error(error?.message || "Storage operation row was not created.");
      return { id: String(data.id) };
    },
    async setStatus(id, status, errorMessage) {
      const update: Record<string, unknown> = {
        status,
        last_error: errorMessage || null,
        updated_at: new Date().toISOString(),
      };
      if (["completed", "compensated", "failed", "cancelled"].includes(status)) {
        update.completed_at = new Date().toISOString();
      }
      if (status === "cleanup_pending") update.attempt_count = 1;
      const { error } = await db.from("storage_object_operations").update(update).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async upload(input) {
      const { error } = await supabase.storage.from(input.bucket).upload(input.path, input.body, {
        upsert: false,
        cacheControl: "31536000",
        contentType: input.contentType,
      });
      if (error) throw new Error(error.message);
    },
    async remove(path, bucket = "product-images") {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) throw new Error(error.message);
    },
  };
}
