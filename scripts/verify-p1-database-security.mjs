import { spawnSync } from "node:child_process";
import process from "node:process";

const container = "supabase_db_clothing_web";
const sql = String.raw`
do $$
declare
  signature text;
  function_oid oid;
  function_is_definer boolean;
  function_config text[];
begin
  foreach signature in array array[
    'public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)',
    'public.pos_void_rpc(uuid,text,text,text)',
    'public.pos_runtime_health_rpc()',
    'public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)',
    'public.inventory_runtime_health_rpc()',
    'public.developer_credential_bootstrap_rpc(text,uuid)',
    'public.developer_credential_rotate_rpc(text,uuid,uuid)'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then
      raise exception 'required function is missing: %', signature;
    end if;

    select p.prosecdef, p.proconfig into function_is_definer, function_config
    from pg_catalog.pg_proc p where p.oid = function_oid;
    if not function_is_definer then
      raise exception 'privileged function must be SECURITY DEFINER: %', signature;
    end if;
    if not exists (
      select 1 from unnest(coalesce(function_config, array[]::text[])) setting
      where setting like 'search_path=%'
    ) then
      raise exception 'SECURITY DEFINER function has no fixed search_path: %', signature;
    end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'untrusted role can execute privileged function: %', signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
      raise exception 'service_role cannot execute required function: %', signature;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
    'service_role',
    'public.pos_checkout_rpc(text,text,jsonb,numeric,text,text)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role can still execute the obsolete checkout signature';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'developer_access' and c.relrowsecurity
  ) then
    raise exception 'developer_access RLS is not enabled';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'developer_access'
  ) then
    raise exception 'developer_access must not have a public RLS policy';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.developer_access', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.developer_access', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.developer_access', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.developer_access', 'insert') then
    raise exception 'untrusted role has developer_access table privileges';
  end if;
end
$$;

select 'P1 database security gates passed';
`;

const result = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-q", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);
if (result.status !== 0) {
  console.error("P1 database security gates failed.");
  console.error(String(result.stderr || "").trim());
  process.exit(1);
}
console.log(String(result.stdout || "").trim());
