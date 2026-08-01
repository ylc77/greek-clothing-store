import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore Node's strip-only runner requires explicit .ts extensions.
import { assertProjectRef, prepareCustomerRoleRestoreSql, resolveManifestFile, verifyCustomerBackup, type CustomerBackupManifest } from "./customer-backup-common.ts";

type Options = {
  projectRef: string;
  backup: string;
  yes: boolean;
  testLocal: boolean;
  databaseOnly: boolean;
  storageOnly: boolean;
};

function fail(message: string): never { throw new Error(message); }

function parseArgs(): Options {
  const args = process.argv.slice(2);
  let projectRef = "";
  let backup = "";
  let yes = false;
  let testLocal = false;
  let databaseOnly = false;
  let storageOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project-ref") projectRef = String(args[++index] || "").trim();
    else if (argument === "--backup") backup = String(args[++index] || "").trim();
    else if (argument === "--yes") yes = true;
    else if (argument === "--test-local") testLocal = true;
    else if (argument === "--database-only") databaseOnly = true;
    else if (argument === "--storage-only") storageOnly = true;
    else fail(`unsupported argument: ${argument}`);
  }
  assertProjectRef(projectRef);
  if (!backup) fail("--backup is required");
  if (databaseOnly && storageOnly) fail("--database-only and --storage-only cannot be combined");
  return { projectRef, backup: path.resolve(backup), yes, testLocal, databaseOnly, storageOnly };
}

function storageTarget(options: Options) {
  const urlValue = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!urlValue || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage restore");
  const url = new URL(urlValue);
  const hosted = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (hosted && hosted[1] !== options.projectRef) fail(`project ref mismatch: URL points to ${hosted[1]}`);
  if (!hosted && !options.testLocal) fail("non-hosted Supabase URLs are refused unless --test-local is used");
  if (options.testLocal && !/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) fail("--test-local is limited to localhost");
  return { url: urlValue, serviceKey };
}

function databaseTarget(options: Options) {
  const raw = String(process.env.SUPABASE_DB_URL || "").trim();
  if (!raw) fail("SUPABASE_DB_URL is required in the maintainer environment for database restore; never pass it on the command line");
  const url = new URL(raw);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) fail("SUPABASE_DB_URL must be a PostgreSQL URL");
  const local = /^(127\.0\.0\.1|localhost)$/.test(url.hostname);
  if (options.testLocal && !local) fail("--test-local SUPABASE_DB_URL must point to localhost");
  if (!options.testLocal) {
    const hostRef = url.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1];
    const userRef = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9-]+)$/i)?.[1];
    if ((hostRef || userRef) !== options.projectRef) fail("database URL project ref does not match --project-ref");
  }
  const password = decodeURIComponent(url.password);
  if (!password || /[\r\n]/.test(password)) fail("SUPABASE_DB_URL has an invalid password component");
  return {
    host: local ? "host.docker.internal" : url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password,
    database: url.pathname.replace(/^\//, "") || "postgres",
    sslmode: url.searchParams.get("sslmode") || (local ? "disable" : "require"),
  };
}

function runDatabaseFile(target: ReturnType<typeof databaseTarget>, file: string) {
  return new Promise<void>((resolve, reject) => {
    const mount = `type=bind,source=${path.resolve(file)},target=/restore/input.sql,readonly`;
    const localHostGateway = process.platform === "linux" && target.host === "host.docker.internal"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];
    const child = spawn("docker", [
      "run", "--rm", "-i",
      ...localHostGateway,
      "--mount", mount,
      "--env", `PGHOST=${target.host}`,
      "--env", `PGPORT=${target.port}`,
      "--env", `PGUSER=${target.user}`,
      "--env", `PGDATABASE=${target.database}`,
      "--env", `PGSSLMODE=${target.sslmode}`,
      "postgres:17-alpine",
      "sh", "-ceu",
      "IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql --no-password --set ON_ERROR_STOP=1 --file /restore/input.sql",
    ], { cwd: process.cwd(), stdio: ["pipe", "inherit", "inherit"], shell: false });
    child.stdin.end(`${target.password}\n`);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`isolated psql container exited with code ${code}`)));
  });
}

async function confirm(options: Options, sourceProjectRef: string) {
  process.stdout.write(`Backup source project ref: ${sourceProjectRef}\n`);
  process.stdout.write(`Restore target project ref: ${options.projectRef}\n`);
  process.stdout.write("Restore is allowed only on a new isolated project with no customer data.\n");
  if (options.yes) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type RESTORE ${options.projectRef} to continue: `);
    if (answer.trim() !== `RESTORE ${options.projectRef}`) fail("target confirmation did not match");
  } finally { prompt.close(); }
}

// The trusted maintenance client intentionally spans Storage types that vary by SDK version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listObjectCount(client: any) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) fail("unable to inspect target Storage buckets");
  let count = 0;
  async function walk(bucket: string, prefix: string, depth: number): Promise<void> {
    if (depth > 20) fail(`Storage tree is too deep in bucket ${bucket}`);
    for (let offset = 0; ; offset += 1000) {
      const result = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (result.error) fail(`unable to inspect target Storage bucket ${bucket}`);
      const page = result.data || [];
      for (const item of page) {
        if (item.id) count += 1;
        else await walk(bucket, prefix ? `${prefix}/${item.name}` : item.name, depth + 1);
      }
      if (page.length < 1000) break;
    }
  }
  for (const bucket of buckets || []) await walk(bucket.id, "", 0);
  return count;
}

async function main() {
  const options = parseArgs();
  const manifestPath = path.join(options.backup, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CustomerBackupManifest;
  const verified = await verifyCustomerBackup(options.backup, manifest);
  await confirm(options, manifest.sourceProjectRef);

  const restoreDatabase = !options.storageOnly;
  const restoreStorage = !options.databaseOnly;
  const clientTarget = restoreStorage ? storageTarget(options) : null;
  const client = clientTarget
    ? createClient(clientTarget.url, clientTarget.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  if (client && await listObjectCount(client) !== 0) fail("target Storage already contains objects; restore refused");

  if (restoreDatabase) {
    const database = databaseTarget(options);
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "clothing-restore-preflight-"));
    try {
      const preflight = path.join(temporaryDirectory, "preflight.sql");
      await writeFile(preflight, `do $$
declare
  row_count bigint;
begin
  if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relkind in ('r','p','v','m','S') and c.relname <> 'spatial_ref_sys') <> 0 then
    raise exception 'RESTORE_TARGET_NOT_EMPTY';
  end if;
  if to_regclass('auth.users') is not null then
    execute 'select count(*) from auth.users' into row_count;
    if row_count <> 0 then raise exception 'RESTORE_AUTH_NOT_EMPTY'; end if;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects' into row_count;
    if row_count <> 0 then raise exception 'RESTORE_STORAGE_NOT_EMPTY'; end if;
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations' into row_count;
    if row_count <> 0 then raise exception 'RESTORE_MIGRATION_HISTORY_NOT_EMPTY'; end if;
  end if;
end $$;
`, "utf8");
      await runDatabaseFile(database, preflight);
    } catch (error) {
      fail(`target database is not empty or cannot be verified; restore refused (${error instanceof Error ? error.message : "preflight failed"})`);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    const restoreInputDirectory = await mkdtemp(path.join(os.tmpdir(), "clothing-restore-input-"));
    try {
      for (const name of ["database/roles.sql", "database/schema.sql", "database/data.sql"]) {
        const entry = manifest.database.find((item) => item.file === name);
        if (!entry) fail(`backup is missing ${name}`);
        let restoreFile = resolveManifestFile(options.backup, entry.file);
        if (name === "database/roles.sql") {
          const sanitizedRoles = prepareCustomerRoleRestoreSql(await readFile(restoreFile, "utf8"));
          restoreFile = path.join(restoreInputDirectory, "roles.sql");
          await writeFile(restoreFile, sanitizedRoles, "utf8");
        }
        await runDatabaseFile(database, restoreFile);
      }
    } finally {
      await rm(restoreInputDirectory, { recursive: true, force: true });
    }
    const migrationHistory = manifest.database.find((item) => item.file === "database/migration-history.sql");
    if (!migrationHistory) fail("backup is missing database/migration-history.sql");
    const migrationSchema = manifest.database.find((item) => item.file === "database/migration-schema.sql");
    const historyDirectory = await mkdtemp(path.join(os.tmpdir(), "clothing-restore-history-"));
    try {
      const historyPreflight = path.join(historyDirectory, "history-preflight.sql");
      await writeFile(historyPreflight, `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
alter table supabase_migrations.schema_migrations add column if not exists created_by text;
alter table supabase_migrations.schema_migrations add column if not exists idempotency_key text;
alter table supabase_migrations.schema_migrations add column if not exists rollback text[];
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 0 then raise exception 'RESTORE_MIGRATION_HISTORY_NOT_EMPTY'; end if;
end $$;
`, "utf8");
      await runDatabaseFile(database, historyPreflight);
      if (migrationSchema) {
        const historyReset = path.join(historyDirectory, "history-reset.sql");
        await writeFile(historyReset, "drop table supabase_migrations.schema_migrations;\n", "utf8");
        await runDatabaseFile(database, historyReset);
        await runDatabaseFile(database, resolveManifestFile(options.backup, migrationSchema.file));
      }
      await runDatabaseFile(database, resolveManifestFile(options.backup, migrationHistory.file));
    } finally {
      await rm(historyDirectory, { recursive: true, force: true });
    }
  }

  if (restoreStorage && client) {
    const { data: existingBuckets, error: bucketError } = await client.storage.listBuckets();
    if (bucketError) fail("unable to inspect restored Storage buckets");
    const existing = new Set((existingBuckets || []).map((bucket) => bucket.id));
    for (const bucket of manifest.buckets) {
      if (!existing.has(bucket.id)) {
        const { error } = await client.storage.createBucket(bucket.id, {
          public: bucket.public,
          fileSizeLimit: bucket.fileSizeLimit || undefined,
          allowedMimeTypes: bucket.allowedMimeTypes || undefined,
        });
        if (error) fail(`unable to create Storage bucket ${bucket.id}`);
      }
    }
    for (const object of manifest.storage) {
      const bytes = await readFile(resolveManifestFile(options.backup, object.file));
      const { error } = await client.storage.from(object.bucket).upload(object.objectPath, bytes, {
        upsert: true,
        contentType: object.contentType || undefined,
      });
      if (error) fail(`unable to restore Storage object ${object.bucket}/${object.objectPath}`);
      const downloaded = await client.storage.from(object.bucket).download(object.objectPath);
      if (downloaded.error || !downloaded.data) fail(`unable to verify restored Storage object ${object.bucket}/${object.objectPath}`);
      const restored = Buffer.from(await downloaded.data.arrayBuffer());
      const hash = (await import("node:crypto")).createHash("sha256").update(restored).digest("hex");
      if (hash !== object.sha256 || restored.byteLength !== object.bytes) fail(`restored Storage checksum mismatch for ${object.bucket}/${object.objectPath}`);
    }
  }

  process.stdout.write(`Restore verified: ${restoreDatabase ? verified.databaseFiles : 0} database files and ${restoreStorage ? verified.storageObjects : 0} Storage objects.\n`);
  process.stdout.write("Run application reconciliation and business smoke tests before promoting this isolated target.\n");
}

main().catch((error) => {
  process.stderr.write(`Customer restore failed: ${error instanceof Error ? error.message : "unexpected error"}\n`);
  process.exitCode = 1;
});
