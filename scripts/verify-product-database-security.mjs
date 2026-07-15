import { spawnSync } from "node:child_process";
import process from "node:process";

const container = process.env.PRODUCT_DB_CONTAINER || "supabase_db_clothing_web";
const sql = String.raw`
do $$
declare
  signature text;
  function_oid oid;
  function_is_definer boolean;
  function_config text[];
begin
  foreach signature in array array[
    'public.product_create_rpc(text,jsonb,jsonb,text,text)',
    'public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)',
    'public.product_bulk_status_rpc(text,jsonb,text,text)',
    'public.product_runtime_health_rpc()',
    'public.product_reconciliation_rpc()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then
      raise exception 'required product function is missing: %', signature;
    end if;

    select p.prosecdef, p.proconfig
    into function_is_definer, function_config
    from pg_catalog.pg_proc p
    where p.oid = function_oid;

    if not function_is_definer then
      raise exception 'privileged product function must be SECURITY DEFINER: %', signature;
    end if;
    if not ('search_path=""' = any(coalesce(function_config, array[]::text[]))) then
      raise exception 'product function must use an empty fixed search_path: %', signature;
    end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'untrusted role can execute product function: %', signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
      raise exception 'service_role cannot execute product function: %', signature;
    end if;
  end loop;

  function_oid := pg_catalog.to_regprocedure('app_private.product_lock_variant_identities(jsonb,bigint)');
  if function_oid is null then
    raise exception 'Variant identity lock helper is missing';
  end if;
  select p.prosecdef, p.proconfig
  into function_is_definer, function_config
  from pg_catalog.pg_proc p
  where p.oid = function_oid;
  if function_is_definer or not ('search_path=""' = any(coalesce(function_config, array[]::text[]))) then
    raise exception 'Variant identity lock helper must be SECURITY INVOKER with an empty fixed search_path';
  end if;
  if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute')
     or pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
    raise exception 'Variant identity lock helper must only be callable by its owning RPC role';
  end if;

  if pg_catalog.to_regclass('public.product_operations') is null then
    raise exception 'product_operations is missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'product_operations'
      and c.relrowsecurity
  ) then
    raise exception 'product_operations RLS is not enabled';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'product_operations'
  ) then
    raise exception 'product_operations must not expose an RLS policy';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.product_operations', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.product_operations', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.product_operations', 'update')
     or pg_catalog.has_table_privilege('anon', 'public.product_operations', 'delete')
     or pg_catalog.has_table_privilege('authenticated', 'public.product_operations', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.product_operations', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.product_operations', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.product_operations', 'delete') then
    raise exception 'untrusted role has product_operations table privileges';
  end if;
  if not pg_catalog.has_table_privilege(
    'service_role',
    'public.product_operations',
    'select,insert,update,delete'
  ) then
    raise exception 'service_role cannot maintain product_operations';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.product_operations'::regclass
      and a.attname = 'operation_key'
      and not a.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.product_operations'::regclass
      and a.attname = 'payload_fingerprint'
      and not a.attisdropped
  ) then
    raise exception 'product operation idempotency columns are missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indrelid = 'public.product_operations'::regclass
      and i.indisunique
      and pg_catalog.pg_get_indexdef(i.indexrelid) ~ '\(operation_key\)'
  ) then
    raise exception 'product_operations.operation_key uniqueness is missing';
  end if;
end
$$;

select 'Product database security gates passed';
`;

const result = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-q", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);

if (result.status !== 0) {
  console.error("Product database security gates failed.");
  console.error(String(result.stderr || "").trim());
  process.exit(1);
}

console.log(String(result.stdout || "").trim());
