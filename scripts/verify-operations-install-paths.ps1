$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$containers = @(
  "clothing_operations_migration_chain_test",
  "clothing_operations_client_init_test",
  "clothing_operations_legacy_upgrade_test"
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
      $fixture = @'
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
grant select, insert, update, delete on storage.buckets to postgres;
'@
      $fixture | docker exec -i -e PGPASSWORD=postgres $Name psql -q -X -h 127.0.0.1 -U supabase_storage_admin -d postgres -v ON_ERROR_STOP=1
      if ($LASTEXITCODE -ne 0) { continue }
      Start-Sleep -Seconds 4
      return
    }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Name"
}

function Invoke-SqlText([string]$Container, [string]$Sql, [string]$Label) {
  $Sql | docker exec -i $Container psql -q -X -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "$Label failed in $Container" }
}

function Invoke-SqlFile([string]$Container, [string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { throw "SQL file not found: $Path" }
  Invoke-SqlText $Container ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)) (Split-Path -Leaf $Path)
}

function Assert-OperationsBoundary([string]$Container, [string]$Label) {
  $assertions = @'
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.pos_day_bounds_rpc(date)',
    'public.pos_orders_page_rpc(text,text,text,text,integer,integer)',
    'public.pos_reconciliation_rpc(timestamp with time zone,timestamp with time zone,uuid,integer,integer)',
    'public.pos_daily_report_rpc(date,integer,integer)',
    'public.pos_search_rpc(text,integer)',
    'public.variant_barcodes_apply_rpc(text,jsonb,text,text)',
    'public.operations_runtime_health_rpc()'
  ] loop
    if pg_catalog.to_regprocedure(signature) is null then raise exception 'missing %', signature; end if;
    if pg_catalog.has_function_privilege('anon',signature,'execute')
       or pg_catalog.has_function_privilege('authenticated',signature,'execute')
       or not pg_catalog.has_function_privilege('service_role',signature,'execute') then
      raise exception 'unsafe execute grant for %', signature;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(signature)
      and proconfig @> array['search_path=""']
    ) then raise exception 'unsafe search_path for %', signature; end if;
  end loop;
  if not exists (select 1 from public.inventory_locations where code='MAIN_STORE' and active) then
    raise exception 'MAIN_STORE missing';
  end if;
  if not exists (select 1 from public.feature_settings where id=1 and plan='advanced') then
    raise exception 'advanced feature default missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class where oid='public.barcode_operations'::pg_catalog.regclass and relrowsecurity
  ) then raise exception 'barcode operation RLS missing'; end if;
  if pg_catalog.has_table_privilege('service_role','public.audit_logs','insert')
     or pg_catalog.has_table_privilege('service_role','public.audit_logs','update')
     or pg_catalog.has_table_privilege('service_role','public.audit_logs','delete')
     or not pg_catalog.has_table_privilege('service_role','public.audit_logs','select') then
    raise exception 'audit log grant boundary unsafe';
  end if;
  if (public.operations_runtime_health_rpc()->>'ready')::boolean is not true then
    raise exception 'operations runtime is not ready';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$Label assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$operations = @($allMigrations | Where-Object { $_.Name -match '^\d+_operations_reporting_audit_barcode\.sql$' })
if ($operations.Count -ne 1) { throw "Expected exactly one operations migration" }
$operationsMigration = $operations[0]
$projectionMigration = @($allMigrations | Where-Object { $_.Name -eq '20260719100000_reconcile_legacy_inventory_projections.sql' })
if ($projectionMigration.Count -ne 1) { throw "Expected legacy inventory projection reconciliation migration" }
if ($operationsMigration.Name -ge $projectionMigration[0].Name) { throw "Operations migration must sort before legacy projection reconciliation" }

try {
  Start-TestContainer $containers[0]
  foreach ($migration in $allMigrations) { Invoke-SqlFile $containers[0] $migration.FullName }
  Assert-OperationsBoundary $containers[0] "ordered migration chain"
  Write-Host "PASS ordered migration chain empty install"
  Remove-TestContainer $containers[0]

  Start-TestContainer $containers[1]
  Invoke-SqlFile $containers[1] $clientInitPath
  Assert-OperationsBoundary $containers[1] "client-init"
  Write-Host "PASS client-init empty install"
  Remove-TestContainer $containers[1]

  Start-TestContainer $containers[2]
  foreach ($migration in $allMigrations) {
    if ($migration.Name -ne $operationsMigration.Name) { Invoke-SqlFile $containers[2] $migration.FullName }
  }
  $legacyActor = "account:owner:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  Invoke-SqlText $containers[2] "insert into public.audit_logs(actor,action,entity,entity_id) values ('$legacyActor','legacy_event','legacy','legacy-preserved');" "legacy audit fixture"
  Invoke-SqlFile $containers[2] $operationsMigration.FullName
  Invoke-SqlFile $containers[2] $operationsMigration.FullName
  Assert-OperationsBoundary $containers[2] "legacy upgrade"
  $legacyAssertion = @"
do `$`$ begin
  if not exists (
    select 1 from public.audit_logs where entity_id='legacy-preserved'
    and actor_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and actor_role='owner' and auth_type='account'
  ) then raise exception 'legacy audit row was not preserved and enriched'; end if;
end `$`$;
"@
  Invoke-SqlText $containers[2] $legacyAssertion "legacy preservation"
  Write-Host "PASS legacy database upgrade and repeated migration safety"
  Remove-TestContainer $containers[2]
}
finally {
  foreach ($container in $containers) { Remove-TestContainer $container }
}

Write-Host "Operations installation paths passed."
