import { spawn } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore Node's strip-only runner requires explicit .ts extensions.
import { CUSTOMER_BACKUP_FORMAT_VERSION, assertProjectRef, sha256File, storageObjectFile, verifyCustomerBackup, type CustomerBackupBucket, type CustomerBackupManifest, type CustomerBackupObject } from "./customer-backup-common.ts";

type Options = { projectRef: string; output: string; yes: boolean; testLocal: boolean };

function fail(message: string): never { throw new Error(message); }

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let projectRef = "";
  let output = "";
  let yes = false;
  let testLocal = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project-ref") projectRef = String(args[++index] || "").trim();
    else if (argument === "--output") output = String(args[++index] || "").trim();
    else if (argument === "--yes") yes = true;
    else if (argument === "--test-local") testLocal = true;
    else fail(`unsupported argument: ${argument}`);
  }
  assertProjectRef(projectRef);
  if (!output) fail("--output is required; choose a protected directory outside Git");
  return { projectRef, output: path.resolve(output), yes, testLocal };
}

function target(options: Options) {
  const urlValue = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!urlValue || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the maintainer environment");
  const url = new URL(urlValue);
  const hosted = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (hosted && hosted[1] !== options.projectRef) fail(`project ref mismatch: URL points to ${hosted[1]}`);
  if (!hosted && !options.testLocal) fail("non-hosted Supabase URLs are refused unless --test-local is used");
  if (options.testLocal && !/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) fail("--test-local is limited to localhost");
  return { url: urlValue, serviceKey };
}

async function confirm(options: Options) {
  process.stdout.write(`Source Supabase project ref: ${options.projectRef}\n`);
  process.stdout.write(`Backup directory: ${options.output}\n`);
  if (options.yes) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type ${options.projectRef} to create the backup: `);
    if (answer.trim() !== options.projectRef) fail("target confirmation did not match");
  } finally { prompt.close(); }
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function npxCommand(args: string[]) {
  if (process.platform !== "win32") return { command: "npx", args };
  const npmCli = String(process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  const npxCli = path.join(path.dirname(npmCli), "npx-cli.js");
  return { command: process.execPath, args: [npxCli, ...args] };
}

async function assertOutputDoesNotExist(output: string) {
  try { await stat(output); fail("backup output already exists; choose a new directory so evidence is never overwritten"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function assertLinkedProjectRef(options: Options) {
  if (options.testLocal) return;
  let linked = "";
  try {
    linked = (await readFile(path.join(process.cwd(), "supabase", ".temp", "project-ref"), "utf8")).trim();
  } catch {
    fail("Supabase CLI link identity is unavailable; run supabase link for the intended project before backup");
  }
  if (linked !== options.projectRef) fail(`linked Supabase project ref does not match --project-ref (${linked || "missing"})`);
}

async function listObjectPaths(storage: ReturnType<typeof createClient>["storage"], bucket: string) {
  const paths: string[] = [];
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 20) fail(`Storage tree is too deep in bucket ${bucket}`);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) fail(`unable to list Storage bucket ${bucket}`);
      const page = data || [];
      for (const item of page) {
        const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) paths.push(objectPath);
        else await walk(objectPath, depth + 1);
      }
      if (page.length < 1000) break;
    }
  }
  await walk("", 0);
  return paths;
}

async function main() {
  const options = parseArgs();
  const credentials = target(options);
  await confirm(options);
  await assertLinkedProjectRef(options);
  await assertOutputDoesNotExist(options.output);
  await mkdir(path.join(options.output, "database"), { recursive: true });

  const connection = options.testLocal ? "--local" : "--linked";
  const databaseSpecs = [
    { file: "database/roles.sql", flags: ["--role-only"] },
    { file: "database/schema.sql", flags: [] },
    { file: "database/data.sql", flags: ["--data-only", "--use-copy", "--schema", "public,app_private,auth"] },
    { file: "database/migration-schema.sql", flags: ["--schema", "supabase_migrations"] },
    { file: "database/migration-history.sql", flags: ["--data-only", "--use-copy", "--schema", "supabase_migrations"] },
  ];
  for (const spec of databaseSpecs) {
    const invocation = npxCommand(["supabase", "db", "dump", connection, "--file", path.join(options.output, spec.file), ...spec.flags]);
    await run(invocation.command, invocation.args);
  }

  const client = createClient(credentials.url, credentials.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bucketRows, error: bucketError } = await client.storage.listBuckets();
  if (bucketError) fail("unable to list Storage buckets");
  const buckets: CustomerBackupBucket[] = (bucketRows || []).map((bucket) => ({
    id: bucket.id,
    public: Boolean(bucket.public),
    fileSizeLimit: typeof bucket.file_size_limit === "number" ? bucket.file_size_limit : null,
    allowedMimeTypes: Array.isArray(bucket.allowed_mime_types) ? bucket.allowed_mime_types : null,
  }));
  const storageObjects: CustomerBackupObject[] = [];
  for (const bucket of buckets) {
    const paths = await listObjectPaths(client.storage, bucket.id);
    for (const objectPath of paths) {
      const { data, error } = await client.storage.from(bucket.id).download(objectPath);
      if (error || !data) fail(`unable to download Storage object ${bucket.id}/${objectPath}`);
      const relativeFile = storageObjectFile(bucket.id, objectPath);
      const outputFile = path.join(options.output, ...relativeFile.split("/"));
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, Buffer.from(await data.arrayBuffer()));
      const digest = await sha256File(outputFile);
      storageObjects.push({
        bucket: bucket.id,
        objectPath,
        file: relativeFile,
        contentType: data.type || null,
        ...digest,
      });
    }
  }

  const database = await Promise.all(databaseSpecs.map(async ({ file }) => ({ file, ...await sha256File(path.join(options.output, file)) })));
  const manifest: CustomerBackupManifest = {
    formatVersion: CUSTOMER_BACKUP_FORMAT_VERSION,
    sourceProjectRef: options.projectRef,
    createdAt: new Date().toISOString(),
    database,
    buckets,
    storage: storageObjects.sort((left, right) => `${left.bucket}/${left.objectPath}`.localeCompare(`${right.bucket}/${right.objectPath}`)),
  };
  const temporaryManifest = path.join(options.output, "manifest.json.tmp");
  const manifestPath = path.join(options.output, "manifest.json");
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryManifest, manifestPath);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as CustomerBackupManifest;
  const verified = await verifyCustomerBackup(options.output, parsed);
  process.stdout.write(`Backup verified: ${verified.databaseFiles} database files and ${verified.storageObjects} Storage objects.\n`);
  process.stdout.write("Store this directory in encrypted offsite storage. It contains customer business data but no service key or database password.\n");
}

main().catch((error) => {
  process.stderr.write(`Customer backup failed: ${error instanceof Error ? error.message : "unexpected error"}\n`);
  process.exitCode = 1;
});
