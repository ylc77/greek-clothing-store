import { spawnSync } from "node:child_process";
import process from "node:process";

const container = process.env.CSV_DB_CONTAINER || "supabase_db_clothing_web";
const sql = String.raw`
do $$
declare
  signature text;
  function_oid oid;
  function_is_definer boolean;
  function_config text[];
  table_name text;
begin
  foreach signature in array array[
    'public.product_import_preview_rpc(jsonb)',
    'public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)',
    'public.product_import_apply_row_rpc(uuid,integer,text,text)',
    'public.product_import_refresh_job_rpc(uuid)',
    'public.product_import_reconciliation_rpc(uuid)',
    'public.product_import_runtime_health_rpc()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then
      raise exception 'required CSV function is missing: %', signature;
    end if;
    select p.prosecdef, p.proconfig into function_is_definer, function_config
    from pg_catalog.pg_proc p where p.oid = function_oid;
    if not function_is_definer then
      raise exception 'privileged CSV function must be SECURITY DEFINER: %', signature;
    end if;
    if not ('search_path=""' = any(coalesce(function_config, array[]::text[]))) then
      raise exception 'CSV function must use an empty fixed search_path: %', signature;
    end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'untrusted role can execute CSV function: %', signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
      raise exception 'service_role cannot execute CSV function: %', signature;
    end if;
  end loop;

  function_oid := pg_catalog.to_regprocedure('app_private.product_import_authoritative_variants(bigint,jsonb)');
  if function_oid is null then raise exception 'private CSV Variant merge helper is missing'; end if;
  select p.prosecdef, p.proconfig into function_is_definer, function_config
  from pg_catalog.pg_proc p where p.oid = function_oid;
  if not function_is_definer
     or not ('search_path=""' = any(coalesce(function_config, array[]::text[]))) then
    raise exception 'private CSV Variant helper must be SECURITY DEFINER with an empty fixed search_path';
  end if;
  if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute')
     or pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
    raise exception 'private CSV Variant helper must only be callable by its owning database role';
  end if;

  foreach table_name in array array['product_import_jobs', 'product_import_rows'] loop
    if pg_catalog.to_regclass('public.' || table_name) is null then
      raise exception 'required CSV table is missing: %', table_name;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then raise exception 'CSV table RLS is disabled: %', table_name; end if;
    if exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = table_name
    ) then raise exception 'CSV table unexpectedly exposes an RLS policy: %', table_name; end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'select')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'insert')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'update')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'delete')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'select')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'insert')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'update')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'delete') then
      raise exception 'untrusted role has CSV table privileges: %', table_name;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'select')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'insert')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'update')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'delete') then
      raise exception 'service_role lacks complete CSV table DML: %', table_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_index i
    where i.indrelid = 'public.product_import_jobs'::regclass
      and i.indisunique
      and pg_catalog.pg_get_indexdef(i.indexrelid) ~ '\(client_request_id\)'
  ) then raise exception 'CSV job operation ID uniqueness is missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    where i.indrelid = 'public.product_import_rows'::regclass
      and i.indisunique
      and pg_catalog.pg_get_indexdef(i.indexrelid) ~ '\(operation_id\)'
  ) then raise exception 'CSV row business operation ID uniqueness is missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.product_import_rows'::regclass
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'product_import_jobs\(id\) ON DELETE CASCADE'
  ) then raise exception 'CSV row-to-job cascading foreign key is missing'; end if;
  if exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.product_import_rows'::regclass
      and c.contype = 'f'
      and a.attname = 'expected_product_id'
  ) then raise exception 'frozen expected_product_id must not be erased through a foreign key'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.product_import_jobs'::regclass
      and c.conname = 'product_import_jobs_counts_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.product_import_rows'::regclass
      and c.conname = 'product_import_rows_status_check'
  ) then raise exception 'CSV lifecycle integrity constraints are missing'; end if;
end
$$;

do $$
declare health jsonb;
begin
  select public.product_import_runtime_health_rpc() into health;
  if not coalesce((health ->> 'ready')::boolean, false)
     or not coalesce((health ->> 'main_store_ready')::boolean, false)
     or not coalesce((health ->> 'private_variant_helper_ready')::boolean, false) then
    raise exception 'CSV runtime health is incomplete: %', health;
  end if;
end
$$;

select 'CSV database security gates passed';
`;

const result = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-q", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);

if (result.status !== 0) {
  console.error("CSV database security gates failed.");
  console.error(String(result.stderr || "").trim());
  process.exit(1);
}

console.log(String(result.stdout || "").trim());
