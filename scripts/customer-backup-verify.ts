import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
// @ts-expect-error Node's strip-only runner requires explicit .ts extensions.
import { verifyCustomerBackup, type CustomerBackupManifest } from "./customer-backup-common.ts";

async function main() {
  const index = process.argv.indexOf("--backup");
  const directory = index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
  if (!directory) throw new Error("--backup is required");
  const root = path.resolve(directory);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as CustomerBackupManifest;
  const result = await verifyCustomerBackup(root, manifest);
  process.stdout.write(`Backup verified: ${result.databaseFiles} database files and ${result.storageObjects} Storage objects.\n`);
}

main().catch((error) => {
  process.stderr.write(`Backup verification failed: ${error instanceof Error ? error.message : "unexpected error"}\n`);
  process.exitCode = 1;
});
