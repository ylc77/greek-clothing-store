$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$inventoryMigration = "20260714234237_transactional_inventory_operations.sql"
$testContainers = @(
  "clothing_inventory_client_init_test",
  "clothing_inventory_legacy_upgrade_test"
)

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Remove-TestContainer([string]$Name) {
  $existing = docker ps -a --filter "name=^/$Name$" --format "{{.Names}}"
  if ($existing -eq $Name) {
    docker rm -f $Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove test container $Name" }
  }
}

function Start-TestContainer([string]$Name) {
  Remove-TestContainer $Name
  docker run -d --name $Name -e POSTGRES_PASSWORD=postgres $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to start test container $Name" }

  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    docker exec $Name pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $storageFixture = @'
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
'@
      $storageFixture | docker exec -i $Name psql -q -X -U postgres -d postgres -v ON_ERROR_STOP=1
      if ($LASTEXITCODE -ne 0) { throw "Failed to initialize the Storage fixture in $Name" }
      Start-Sleep -Seconds 6
      docker exec $Name pg_isready -U postgres 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return }
    }
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for test container $Name"
}

function Invoke-SqlText([string]$Container, [string]$Sql, [string]$Label) {
  $Sql | docker exec -i $Container psql -q -X -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "$Label failed in $Container" }
}

function Invoke-SqlFile([string]$Container, [string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { throw "SQL file not found: $Path" }
  $sql = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Invoke-SqlText $Container $sql (Split-Path -Leaf $Path)
}

function Assert-InventorySchema([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
declare
  v_health jsonb;
begin
  if pg_catalog.to_regclass('public.inventory_operations') is null then
    raise exception 'inventory_operations is missing';
  end if;
  if pg_catalog.to_regprocedure('public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)') is null then
    raise exception 'inventory transaction RPC is missing';
  end if;
  if pg_catalog.to_regprocedure('public.inventory_runtime_health_rpc()') is null then
    raise exception 'inventory health RPC is missing';
  end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute inventory transaction RPC';
  end if;
  if pg_catalog.has_function_privilege(
    'anon',
    'public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute inventory transaction RPC';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute inventory transaction RPC';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'inventory_apply_rpc'
      and p.prosecdef
      and 'search_path=""' = any(p.proconfig)
  ) then
    raise exception 'inventory RPC is not SECURITY DEFINER with an empty search_path';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_operations'
      and c.relrowsecurity
  ) then
    raise exception 'inventory_operations RLS is not enabled';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.inventory_operations'::regclass
      and con.contype = 'u'
      and pg_catalog.pg_get_constraintdef(con.oid) like 'UNIQUE (operation_key)%'
  ) then
    raise exception 'inventory operation_key uniqueness is missing';
  end if;
  if not exists (select 1 from public.inventory_locations where code = 'MAIN_STORE') then
    raise exception 'MAIN_STORE is missing';
  end if;

  v_health := public.inventory_runtime_health_rpc();
  if coalesce((v_health ->> 'ready')::boolean, false) is not true then
    raise exception 'inventory runtime health is not ready: %', v_health;
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

try {
  $clientContainer = $testContainers[0]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-InventorySchema $clientContainer "client-init empty install"
  Write-Host "PASS inventory client-init empty Supabase installation"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[1]
  Start-TestContainer $legacyContainer
  $allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
  $upgradeMigration = $allMigrations | Where-Object { $_.Name -eq $inventoryMigration }
  if (@($upgradeMigration).Count -ne 1) { throw "Expected exactly one inventory transaction migration" }

  foreach ($migration in ($allMigrations | Where-Object { $_.Name -ne $inventoryMigration })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Invoke-SqlText $legacyContainer "drop function if exists public.set_updated_at() cascade;" "legacy missing trigger helper fixture"
  $legacyFunctionFixture = @'
create or replace function public.inventory_apply_rpc(
  text, uuid, text, integer, text, text, text, boolean
)
returns jsonb
language sql
as $$ select '{"legacy": true}'::jsonb $$;

create or replace function public.inventory_runtime_health_rpc()
returns jsonb
language sql
as $$ select '{"ready": false, "version": "legacy"}'::jsonb $$;
'@
  Invoke-SqlText $legacyContainer $legacyFunctionFixture "legacy inventory function fixture"
  Invoke-SqlFile $legacyContainer $upgradeMigration.FullName
  Assert-InventorySchema $legacyContainer "legacy database upgrade"
  Write-Host "PASS inventory legacy migration-chain upgrade"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
