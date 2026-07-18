import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// @ts-ignore Node's strip-only test runner requires the explicit .ts extension.
import { CUSTOMER_BACKUP_FORMAT_VERSION, resolveManifestFile, sha256File, storageObjectFile, verifyCustomerBackup } from "../scripts/customer-backup-common.ts";

test("backup manifests verify database and Storage hashes and reject tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clothing-backup-test-"));
  try {
    const databaseFile = path.join(root, "database", "schema.sql");
    const objectFile = path.join(root, "storage", "product-images", "audit.webp");
    await mkdir(path.dirname(databaseFile), { recursive: true });
    await mkdir(path.dirname(objectFile), { recursive: true });
    await writeFile(databaseFile, "select 1;\n");
    await writeFile(objectFile, Buffer.from([1, 2, 3, 4]));
    const database = await sha256File(databaseFile);
    const object = await sha256File(objectFile);
    const manifest = {
      formatVersion: CUSTOMER_BACKUP_FORMAT_VERSION,
      sourceProjectRef: "local-test",
      createdAt: "2026-07-18T00:00:00.000Z",
      database: [{ file: "database/schema.sql", ...database }],
      buckets: [{ id: "product-images", public: true, fileSizeLimit: null, allowedMimeTypes: null }],
      storage: [{ file: "storage/product-images/audit.webp", bucket: "product-images", objectPath: "audit.webp", contentType: "image/webp", ...object }],
    };
    assert.deepEqual(await verifyCustomerBackup(root, manifest), { databaseFiles: 1, storageObjects: 1 });
    await writeFile(objectFile, Buffer.from([9, 9, 9]));
    await assert.rejects(() => verifyCustomerBackup(root, manifest), /checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup paths cannot escape the backup root", () => {
  assert.throws(() => resolveManifestFile("C:/backup", "../secret"), /unsafe|escapes/);
  assert.throws(() => resolveManifestFile("C:/backup", "C:/secret"), /unsafe/);
  assert.throws(() => resolveManifestFile("C:/backup", "/etc/passwd"), /unsafe/);
  assert.throws(() => resolveManifestFile("C:/backup", "\\\\server\\share\\secret"), /unsafe/);
  assert.equal(storageObjectFile("product-images", "catalog/a b.webp"), "storage/product-images/catalog/a%20b.webp");
});

test("backup and restore CLIs fail closed on project identity and non-empty targets", () => {
  const backup = fs.readFileSync(path.join(process.cwd(), "scripts/customer-backup.ts"), "utf8");
  const restore = fs.readFileSync(path.join(process.cwd(), "scripts/customer-restore.ts"), "utf8");
  assert.match(backup, /path\.join\(process\.cwd\(\), "supabase", "\.temp", "project-ref"\)/);
  assert.match(backup, /linked Supabase project ref does not match/);
  assert.match(restore, /RESTORE_AUTH_NOT_EMPTY/);
  assert.match(restore, /RESTORE_STORAGE_NOT_EMPTY/);
  assert.match(restore, /RESTORE_MIGRATION_HISTORY_NOT_EMPTY/);
});
