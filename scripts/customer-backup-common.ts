import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export const CUSTOMER_BACKUP_FORMAT_VERSION = 1 as const;

export type CustomerBackupFile = {
  file: string;
  bytes: number;
  sha256: string;
};

export type CustomerBackupBucket = {
  id: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
};

export type CustomerBackupObject = CustomerBackupFile & {
  bucket: string;
  objectPath: string;
  contentType: string | null;
};

export type CustomerBackupManifest = {
  formatVersion: typeof CUSTOMER_BACKUP_FORMAT_VERSION;
  sourceProjectRef: string;
  createdAt: string;
  database: CustomerBackupFile[];
  buckets: CustomerBackupBucket[];
  storage: CustomerBackupObject[];
};

export function assertProjectRef(value: string) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(value)) {
    throw new Error("--project-ref is required and must identify the target project");
  }
  return value;
}

export function storageObjectFile(bucket: string, objectPath: string) {
  const encode = (value: string) => encodeURIComponent(value).replace(/%2F/gi, "%252F");
  const segments = objectPath.split("/").filter(Boolean).map(encode);
  if (!segments.length) throw new Error("Storage object path is empty");
  return path.posix.join("storage", encode(bucket), ...segments);
}

export function resolveManifestFile(backupRoot: string, relativeFile: string) {
  const normalized = relativeFile.replace(/\\/g, "/");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(relativeFile) ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error("backup manifest contains an unsafe file path");
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error("backup manifest contains an unsafe file path");
  }
  const root = path.resolve(backupRoot);
  const resolved = path.resolve(root, ...normalized.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("backup manifest file escapes the backup directory");
  }
  return resolved;
}

export function prepareCustomerRoleRestoreSql(sql: string) {
  const newline = sql.includes("\r\n") ? "\r\n" : "\n";
  const platformManagedParameterGrant = /^\s*GRANT\s+SET\s+ON\s+PARAMETER\s+"?log_min_messages"?\s+TO\s+"?supabase_realtime_admin"?\s*;\s*$/i;
  return sql
    .split(/\r?\n/)
    .filter((line) => !platformManagedParameterGrant.test(line))
    .join(newline);
}

export async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const metadata = await stat(filePath);
  return { sha256: hash.digest("hex"), bytes: metadata.size };
}

export async function verifyCustomerBackup(backupRoot: string, manifest: CustomerBackupManifest) {
  if (manifest.formatVersion !== CUSTOMER_BACKUP_FORMAT_VERSION) throw new Error("unsupported customer backup format");
  assertProjectRef(manifest.sourceProjectRef);
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("backup manifest has an invalid timestamp");

  const files = [...manifest.database, ...manifest.storage];
  const seen = new Set<string>();
  for (const entry of files) {
    if (seen.has(entry.file)) throw new Error(`backup manifest repeats file ${entry.file}`);
    seen.add(entry.file);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`backup manifest metadata is invalid for ${entry.file}`);
    }
    const actual = await sha256File(resolveManifestFile(backupRoot, entry.file));
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) {
      throw new Error(`backup checksum mismatch for ${entry.file}`);
    }
  }
  return { databaseFiles: manifest.database.length, storageObjects: manifest.storage.length };
}
