$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$checkoutMigration = "20260715100000_harden_pos_checkout_rpc.sql"
$voidMigration = "20260715100001_reconcile_pos_void_rpc.sql"
$testContainers = @(
  "clothing_pos_client_init_test",
  "clothing_pos_legacy_upgrade_test"
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
      docker exec -e PGPASSWORD=postgres $Name pg_isready -h 127.0.0.1 -U supabase_storage_admin -d postgres 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { continue }
      $storageFixture = @'
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
grant select, insert, update, delete on storage.buckets to postgres;
'@
      $storageFixture | docker exec -i -e PGPASSWORD=postgres $Name psql -q -X -h 127.0.0.1 -U supabase_storage_admin -d postgres -v ON_ERROR_STOP=1
      if ($LASTEXITCODE -ne 0) { continue }
      # The image briefly accepts connections before its first-start scripts
      # complete. Wait for that window to pass, then verify readiness again.
      Start-Sleep -Seconds 6
      docker exec $Name pg_isready -U postgres 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return }
    }
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for test container $Name"
}

function Invoke-SqlText([string]$Container, [string]$Sql, [string]$Label, [string]$DatabaseUser = "postgres") {
  $Sql | docker exec -i $Container psql -q -X -U $DatabaseUser -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "$Label failed in $Container" }
}

function Invoke-SqlFile([string]$Container, [string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { throw "SQL file not found: $Path" }
  $sql = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Invoke-SqlText $Container $sql (Split-Path -Leaf $Path)
}

function Assert-PosSchema([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
begin
  if pg_catalog.to_regprocedure('public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'checkout v2 RPC is missing';
  end if;
  if pg_catalog.to_regprocedure('public.pos_void_rpc(uuid,text,text,text)') is null then
    raise exception 'void RPC is missing';
  end if;
  if pg_catalog.to_regprocedure('public.pos_runtime_health_rpc()') is null then
    raise exception 'POS health RPC is missing';
  end if;
  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute checkout v2';
  end if;
  if pg_catalog.has_function_privilege(
    'anon',
    'public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute checkout v2';
  end if;
  if not exists (select 1 from public.inventory_locations where code = 'MAIN_STORE') then
    raise exception 'MAIN_STORE is missing';
  end if;
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'id') <> 'bigint' then
    raise exception 'products.id is not bigint';
  end if;
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'product_variants' and column_name = 'product_id') <> 'bigint' then
    raise exception 'product_variants.product_id is not bigint';
  end if;
  if (select plan from public.feature_settings where id = 1) <> 'advanced' then
    raise exception 'feature_settings default plan is not advanced';
  end if;
end;
$$;

select public.pos_runtime_health_rpc();
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

try {
  $clientContainer = $testContainers[0]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-PosSchema $clientContainer "client-init empty install"
  Write-Host "PASS client-init empty Supabase installation"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[1]
  Start-TestContainer $legacyContainer
  $allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
  $legacyMigrations = $allMigrations | Where-Object { $_.Name -notin @($checkoutMigration, $voidMigration) }
  $upgradeMigrations = $allMigrations | Where-Object { $_.Name -in @($checkoutMigration, $voidMigration) }
  if ($upgradeMigrations.Count -ne 2) { throw "Expected both POS upgrade migrations" }

  foreach ($migration in $legacyMigrations) { Invoke-SqlFile $legacyContainer $migration.FullName }
  Invoke-SqlText $legacyContainer "drop function if exists public.set_updated_at() cascade;" "legacy missing trigger helper fixture"
  foreach ($migration in $upgradeMigrations) { Invoke-SqlFile $legacyContainer $migration.FullName }
  Assert-PosSchema $legacyContainer "legacy database upgrade"
  Write-Host "PASS legacy migration-chain upgrade"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
