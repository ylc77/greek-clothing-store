$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$testContainers = @(
  "clothing_ai_auth_migration_chain_test",
  "clothing_ai_auth_client_init_test",
  "clothing_ai_auth_legacy_upgrade_test",
  "clothing_ai_auth_duplicate_guard_test"
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
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
grant select, insert, update, delete on storage.buckets to postgres;
'@
      $storageFixture | docker exec -i -e PGPASSWORD=postgres $Name psql -q -X -h 127.0.0.1 -U supabase_storage_admin -d postgres -v ON_ERROR_STOP=1
      if ($LASTEXITCODE -ne 0) { continue }
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

function Assert-AiAuthBoundary([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
declare
  table_name text;
  function_signature text;
begin
  foreach table_name in array array[
    'security_rate_limit_buckets', 'ai_usage_daily',
    'ai_request_leases', 'security_auth_limits'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=table_name and c.relrowsecurity
    ) then raise exception 'RLS missing for %', table_name; end if;
    if exists (
      select 1 from pg_catalog.pg_policies
      where schemaname='public' and tablename=table_name
    ) then raise exception 'unexpected public policy on %', table_name; end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'select')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'select') then
      raise exception 'public role can read %', table_name;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'select')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'insert')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'update')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'delete') then
      raise exception 'service_role DML missing for %', table_name;
    end if;
  end loop;

  foreach function_signature in array array[
    'public.ai_rate_limit_begin_rpc(uuid,text,jsonb,jsonb,integer,integer,integer)',
    'public.ai_rate_limit_finish_rpc(uuid,text,integer)',
    'public.auth_rate_limit_status_rpc(text,text)',
    'public.auth_rate_limit_record_rpc(text,text,boolean,integer,integer,integer,integer)'
  ] loop
    if pg_catalog.to_regprocedure(function_signature) is null then
      raise exception 'missing function %', function_signature;
    end if;
    if pg_catalog.has_function_privilege('anon', function_signature, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_signature, 'execute')
       or not pg_catalog.has_function_privilege('service_role', function_signature, 'execute') then
      raise exception 'unsafe EXECUTE grant for %', function_signature;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid=pg_catalog.to_regprocedure(function_signature)
        and proconfig @> array['search_path=""']
    ) then raise exception 'unsafe search_path for %', function_signature; end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_index
    where indexrelid='public.admin_users_email_ci_unique_idx'::regclass and indisunique
  ) then raise exception 'case-insensitive admin email uniqueness missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.admin_users'::regclass and conname='admin_users_email_normalized_check'
  ) then raise exception 'admin email normalization check missing'; end if;

  if pg_catalog.to_regprocedure('public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)') is null
     or pg_catalog.to_regprocedure('public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)') is null
     or pg_catalog.to_regprocedure('public.product_create_rpc(text,jsonb,jsonb,text,text)') is null
     or pg_catalog.to_regprocedure('public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)') is null then
    raise exception 'AI/auth installation damaged a prior transactional RPC';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

function Add-UniqueLegacyFixture([string]$Container) {
  $fixture = @'
set session_replication_role = replica;
insert into public.admin_users(id,email,display_name,role,active,created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',' Unique.Owner@Example.Test ','Unique legacy owner','owner',true,'legacy-fixture');
set session_replication_role = origin;
'@
  Invoke-SqlText $Container $fixture "unique legacy admin fixture"
}

function Assert-UniqueLegacyFixture([string]$Container) {
  $assertions = @'
do $$ begin
  if not exists (
    select 1 from public.admin_users
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and email='unique.owner@example.test'
      and display_name='Unique legacy owner'
      and role='owner' and active
  ) then raise exception 'unique legacy admin row was not normalized and preserved'; end if;
end $$;
'@
  Invoke-SqlText $Container $assertions "unique legacy preservation assertions"
}

function Add-DuplicateLegacyFixture([string]$Container) {
  $fixture = @'
set session_replication_role = replica;
insert into public.admin_users(id,email,display_name,role,active,created_by) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Duplicate@Example.Test','Duplicate one','staff',true,'legacy-fixture'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','duplicate@example.test','Duplicate two','readonly',true,'legacy-fixture');
set session_replication_role = origin;
'@
  Invoke-SqlText $Container $fixture "duplicate legacy admin fixture"
}

function Assert-DuplicateUpgradeStopsSafely([string]$Container, [string]$MigrationPath) {
  $sql = [System.IO.File]::ReadAllText($MigrationPath, [System.Text.Encoding]::UTF8)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = $sql | docker exec -i $Container psql -q -X -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1
    $migrationExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($migrationExitCode -eq 0) { throw "Duplicate legacy email upgrade unexpectedly succeeded" }
  $joined = $output -join "`n"
  if ($joined -notmatch "ADMIN_USER_EMAIL_CONFLICT") { throw "Duplicate legacy email upgrade failed without the explicit reconciliation marker" }
  $assertions = @'
do $$ begin
  if pg_catalog.to_regclass('public.security_rate_limit_buckets') is not null then
    raise exception 'failed migration left partial abuse-protection schema';
  end if;
  if (select count(*) <> 2 from public.admin_users where lower(btrim(email))='duplicate@example.test') then
    raise exception 'failed migration changed duplicate legacy rows';
  end if;
end $$;
'@
  Invoke-SqlText $Container $assertions "duplicate upgrade rollback assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$securityMigrations = @($allMigrations | Where-Object { $_.Name -match '^\d+_ai_auth_abuse_protection\.sql$' })
if ($securityMigrations.Count -ne 1) { throw "Expected exactly one *_ai_auth_abuse_protection.sql migration" }
$securityMigration = $securityMigrations[0]
$securityVersion = [Int64]($securityMigration.Name.Split('_')[0])
if ($securityVersion -le 20260716141423) { throw "AI/auth migration must sort after storage hardening" }

try {
  $chainContainer = $testContainers[0]
  Start-TestContainer $chainContainer
  foreach ($migration in $allMigrations) { Invoke-SqlFile $chainContainer $migration.FullName }
  Assert-AiAuthBoundary $chainContainer "ordered migration chain empty install"
  Write-Host "PASS ordered migration chain creates AI/auth security from an empty database"
  Remove-TestContainer $chainContainer

  $clientContainer = $testContainers[1]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-AiAuthBoundary $clientContainer "client-init empty install"
  Write-Host "PASS client-init creates AI/auth security from an empty database"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[2]
  Start-TestContainer $legacyContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $securityMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Add-UniqueLegacyFixture $legacyContainer
  Invoke-SqlFile $legacyContainer $securityMigration.FullName
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -gt $securityMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Assert-AiAuthBoundary $legacyContainer "origin-master legacy upgrade"
  Assert-UniqueLegacyFixture $legacyContainer
  Write-Host "PASS legacy upgrade normalizes and preserves a unique admin account"
  Remove-TestContainer $legacyContainer

  $duplicateContainer = $testContainers[3]
  Start-TestContainer $duplicateContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $securityMigration.Name })) {
    Invoke-SqlFile $duplicateContainer $migration.FullName
  }
  Add-DuplicateLegacyFixture $duplicateContainer
  Assert-DuplicateUpgradeStopsSafely $duplicateContainer $securityMigration.FullName
  Write-Host "PASS duplicate case-insensitive admin emails stop safely with explicit reconciliation"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
