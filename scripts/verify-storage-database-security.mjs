import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const container = "supabase_db_clothing_web";

function sql(statement) {
  const result = spawnSync("docker", [
    "exec", "-i", container,
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: statement, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "database security query failed");
  return String(result.stdout || "").trim();
}

const report = JSON.parse(sql(`
select json_build_object(
  'operationRls', (select relrowsecurity from pg_class where oid='public.storage_object_operations'::regclass),
  'deleteRls', (select relrowsecurity from pg_class where oid='public.product_delete_operations'::regclass),
  'publicPolicies', (select count(*) from pg_policies where schemaname='public' and tablename in ('storage_object_operations','product_delete_operations')),
  'publicGrants', (
    select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name in ('storage_object_operations','product_delete_operations')
      and grantee in ('anon','authenticated')
  ),
  'serviceTables', (
    select count(distinct table_name) from information_schema.role_table_grants
    where table_schema='public' and table_name in ('storage_object_operations','product_delete_operations')
      and grantee='service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ),
  'rpcExists', to_regprocedure('public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])') is not null,
  'rpcDefiner', (
    select prosecdef from pg_proc where oid=to_regprocedure('public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])')
  ),
  'rpcSearchPath', (
    select 'search_path=""'=any(coalesce(proconfig,array[]::text[]))
    from pg_proc where oid=to_regprocedure('public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])')
  ),
  'anonExecute', has_function_privilege('anon','public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])','execute'),
  'authenticatedExecute', has_function_privilege('authenticated','public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])','execute'),
  'serviceExecute', has_function_privilege('service_role','public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])','execute'),
  'bucket', (
    select json_build_object('public',public,'limit',file_size_limit,'mimes',allowed_mime_types)
    from storage.buckets where id='product-images'
  ),
  'storageWritePolicies', (
    select count(*) from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('INSERT','UPDATE','DELETE','ALL')
  )
);
`));

assert.equal(report.operationRls, true);
assert.equal(report.deleteRls, true);
assert.equal(Number(report.publicPolicies), 0);
assert.equal(Number(report.publicGrants), 0);
assert.equal(Number(report.serviceTables), 2);
assert.equal(report.rpcExists, true);
assert.equal(report.rpcDefiner, true);
assert.equal(report.rpcSearchPath, true);
assert.equal(report.anonExecute, false);
assert.equal(report.authenticatedExecute, false);
assert.equal(report.serviceExecute, true);
assert.equal(report.bucket.public, true);
assert.equal(Number(report.bucket.limit), 10 * 1024 * 1024);
assert.deepEqual(new Set(report.bucket.mimes), new Set(["image/jpeg", "image/png", "image/webp"]));
assert.equal(Number(report.storageWritePolicies), 0);

console.log("Storage/image database security gates passed.");
