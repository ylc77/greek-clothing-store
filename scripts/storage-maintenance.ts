import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error Node's strip-only runner requires explicit .ts extensions.
import { configuredStorageOrigin, normalizeStorageObjectPath, productImagesBucket, storagePathFromPublicUrl } from "../lib/storage-images.ts";
// @ts-expect-error Node's strip-only runner requires explicit .ts extensions.
import { reconcileStorageInventory } from "../lib/storage-reconciliation.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Explicit environment values remain supported for CI and isolated tests.
}

type Action = "reconcile" | "recover";

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments() {
  const [actionValue, ...rest] = process.argv.slice(2);
  if (actionValue !== "reconcile" && actionValue !== "recover") fail("expected reconcile or recover");
  let projectRef = "";
  let yes = false;
  let testLocal = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--project-ref") {
      projectRef = String(rest[index + 1] || "").trim();
      index += 1;
    } else if (rest[index] === "--yes") yes = true;
    else if (rest[index] === "--test-local") testLocal = true;
    else fail(`unsupported argument: ${rest[index]}`);
  }
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(projectRef)) fail("--project-ref is required");
  return { action: actionValue as Action, projectRef, yes, testLocal };
}

function target(options: ReturnType<typeof parseArguments>) {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required locally");
  const parsed = new URL(url);
  const hosted = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (hosted && hosted[1] !== options.projectRef) fail(`project ref mismatch: target is ${hosted[1]}`);
  if (!hosted && !options.testLocal) fail("non-hosted URLs require --test-local");
  if (options.testLocal && !/^(127\.0\.0\.1|localhost)$/.test(parsed.hostname)) fail("--test-local is limited to localhost");
  return { url, key };
}

async function confirm(options: ReturnType<typeof parseArguments>) {
  process.stdout.write(`Target Supabase project ref: ${options.projectRef}\n`);
  if (options.action === "reconcile" || options.yes) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type ${options.projectRef} to process queued object deletions: `);
    if (answer.trim() !== options.projectRef) fail("target confirmation did not match");
  } finally {
    prompt.close();
  }
}

async function allRows<T>(queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) fail(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// The maintenance CLI intentionally spans several private tables that are not
// part of the browser-facing generated Database type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MaintenanceClient = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listObjects(storage: any) {
  const paths: string[] = [];
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 10) fail(`storage tree exceeds safe depth at ${prefix}`);
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await storage.from(productImagesBucket).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) fail(error.message);
      const items = data || [];
      for (const item of items) {
        const path = normalizeStorageObjectPath(prefix ? `${prefix}/${item.name}` : item.name);
        if (item.id) paths.push(path);
        else await walk(path, depth + 1);
      }
      if (items.length < pageSize) break;
    }
  }
  await walk("", 0);
  return Array.from(new Set(paths));
}

async function reconcile(client: MaintenanceClient) {
  const origin = configuredStorageOrigin();
  const products = await allRows<Record<string, unknown>>(async (from, to) => {
    const result = await client.from("products").select("image_url,image_urls").range(from, to);
    return { data: result.data as Record<string, unknown>[] | null, error: result.error };
  });
  const categories = await allRows<Record<string, unknown>>(async (from, to) => {
    const result = await client.from("product_categories").select("image_url").range(from, to);
    return { data: result.data as Record<string, unknown>[] | null, error: result.error };
  });
  const { data: settings, error: settingsError } = await client.from("business_settings").select("logo_url,hero_image_url");
  if (settingsError) fail(settingsError.message);
  const { data: pending, error: pendingError } = await client
    .from("storage_object_operations")
    .select("object_path")
    .in("status", ["prepared", "storage_ready", "reference_removed", "cleanup_pending"]);
  if (pendingError) fail(pendingError.message);

  const urls: string[] = [];
  for (const row of products) {
    if (typeof row.image_url === "string") urls.push(row.image_url);
    if (Array.isArray(row.image_urls)) urls.push(...row.image_urls.filter((value): value is string => typeof value === "string"));
  }
  for (const row of categories) if (typeof row.image_url === "string") urls.push(row.image_url);
  for (const row of (settings || []) as Array<Record<string, unknown>>) {
    if (typeof row.logo_url === "string") urls.push(row.logo_url);
    if (typeof row.hero_image_url === "string") urls.push(row.hero_image_url);
  }
  const referencedPaths = urls.map((url) => storagePathFromPublicUrl(url, origin)).filter((path): path is string => Boolean(path));
  const objectPaths = await listObjects(client.storage);
  const report = reconcileStorageInventory({
    objectPaths,
    referencedPaths,
    pendingCleanupPaths: ((pending || []) as Array<Record<string, unknown>>).map((row) => String(row.object_path || "")).filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify({
    mode: "read-only",
    objectCount: objectPaths.length,
    referenceCount: referencedPaths.length,
    orphanCount: report.orphanPaths.length,
    missingObjectCount: report.missingObjectPaths.length,
    pendingCleanupCount: report.pendingCleanupPaths.length,
    orphanPaths: report.orphanPaths,
    missingObjectPaths: report.missingObjectPaths,
    pendingCleanupPaths: report.pendingCleanupPaths,
    mutated: report.mutated,
  }, null, 2)}\n`);
  if (report.missingObjectPaths.length > 0 || report.pendingCleanupPaths.length > 0) process.exitCode = 2;
}

async function recover(client: MaintenanceClient) {
  const { data: operations, error } = await client
    .from("storage_object_operations")
    .select("id,object_path,status,attempt_count")
    .in("status", ["reference_removed", "cleanup_pending"])
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) fail(error.message);
  let completed = 0;
  let failed = 0;
  for (const operation of (operations || []) as Array<Record<string, unknown>>) {
    const path = normalizeStorageObjectPath(String(operation.object_path));
    const { error: removeError } = await client.storage.from(productImagesBucket).remove([path]);
    const next = removeError
      ? { status: "cleanup_pending", last_error: removeError.message.slice(0, 1000), attempt_count: Number(operation.attempt_count || 0) + 1 }
      : { status: "completed", last_error: null, attempt_count: Number(operation.attempt_count || 0) + 1, completed_at: new Date().toISOString() };
    const { error: updateError } = await client.from("storage_object_operations").update(next).eq("id", operation.id);
    if (updateError) fail(updateError.message);
    if (removeError) failed += 1;
    else completed += 1;
  }
  process.stdout.write(`${JSON.stringify({ processed: (operations || []).length, completed, failed })}\n`);
  if (failed > 0) process.exitCode = 2;
}

const options = parseArguments();
const destination = target(options);
await confirm(options);
const client = createClient(destination.url, destination.key, { auth: { persistSession: false, autoRefreshToken: false } });
if (options.action === "reconcile") await reconcile(client);
else await recover(client);
