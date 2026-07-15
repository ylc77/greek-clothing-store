$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$schemaMigration = "20260715090000_add_developer_access.sql"
$hardeningMigration = "20260715110000_harden_developer_credentials.sql"
$testContainers = @(
  "clothing_developer_client_init_test",
  "clothing_developer_legacy_shared_test",
  "clothing_developer_unique_upgrade_test"
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
      # The image briefly accepts connections before first-start initialization
      # completes. Wait through that window before creating the Storage fixture.
      Start-Sleep -Seconds 6
      docker exec $Name pg_isready -U postgres 2>$null | Out-Null
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
      if ($LASTEXITCODE -ne 0) { throw "Failed to initialize Storage fixture in $Name" }
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
  $sql = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Invoke-SqlText $Container $sql (Split-Path -Leaf $Path)
}

function New-RandomBytes([int]$Length) {
  [byte[]]$bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return $bytes
}

function New-ValidCredentialHash {
  $salt = [Convert]::ToBase64String((New-RandomBytes 24))
  $derived = [Convert]::ToBase64String((New-RandomBytes 64))
  return "scrypt`$16384`$8`$1`$$salt`$$derived"
}

function Assert-DeveloperSchema([string]$Container, [string]$ExpectedState, [string]$ExpectedMarker = "") {
  $stateAssertion = if ($ExpectedState -eq "empty") {
    "if exists (select 1 from public.developer_access) then raise exception 'clean install seeded a credential'; end if;"
  } else {
    "if not exists (select 1 from public.developer_access where id = 1 and must_rotate and credential_version is not null and password_version >= 1) then raise exception 'legacy credential was not forced to rotate'; end if;"
  }
  $markerAssertion = if ($ExpectedMarker) {
    "if not exists (select 1 from public.business_settings where business_name = '$ExpectedMarker') or not exists (select 1 from public.feature_settings where updated_by = '$ExpectedMarker') or not exists (select 1 from public.legal_settings where updated_by = '$ExpectedMarker') then raise exception 'existing Store Legal or Feature data was lost'; end if;"
  } else { "" }
  $assertions = @"
do `$`$
begin
  if pg_catalog.to_regclass('public.developer_access') is null then raise exception 'developer_access is missing'; end if;
  if pg_catalog.to_regprocedure('public.developer_credential_bootstrap_rpc(text,uuid)') is null then raise exception 'bootstrap RPC is missing'; end if;
  if pg_catalog.to_regprocedure('public.developer_credential_rotate_rpc(text,uuid,uuid)') is null then raise exception 'rotate RPC is missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'developer_access' and c.relrowsecurity
  ) then raise exception 'developer_access RLS is disabled'; end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.developer_access'::regclass) then raise exception 'developer_access unexpectedly has a public policy'; end if;
  if pg_catalog.has_table_privilege('anon', 'public.developer_access', 'SELECT') or pg_catalog.has_table_privilege('authenticated', 'public.developer_access', 'SELECT') then raise exception 'public roles can read developer_access'; end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.developer_access', 'SELECT,INSERT,UPDATE,DELETE') then raise exception 'service_role cannot maintain developer_access'; end if;
  if pg_catalog.has_function_privilege('anon', 'public.developer_credential_bootstrap_rpc(text,uuid)', 'EXECUTE') or pg_catalog.has_function_privilege('authenticated', 'public.developer_credential_rotate_rpc(text,uuid,uuid)', 'EXECUTE') then raise exception 'public role can execute credential RPC'; end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.developer_credential_bootstrap_rpc(text,uuid)', 'EXECUTE') or not pg_catalog.has_function_privilege('service_role', 'public.developer_credential_rotate_rpc(text,uuid,uuid)', 'EXECUTE') then raise exception 'service_role credential RPC privilege is missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'developer_credential_bootstrap_rpc' and p.prosecdef and 'search_path=""' = any(p.proconfig)
  ) then raise exception 'bootstrap RPC security boundary is invalid'; end if;
  $stateAssertion
  $markerAssertion
end;
`$`$;
"@
  Invoke-SqlText $Container $assertions "$ExpectedState developer credential assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
if ($allMigrations[-1].Name -ne $hardeningMigration) {
  throw "Developer credential hardening migration must sort after every existing migration"
}
if ([array]::IndexOf([string[]]$allMigrations.Name, "20260715102000_transactional_inventory_operations.sql") -lt [array]::IndexOf([string[]]$allMigrations.Name, "20260715100001_reconcile_pos_void_rpc.sql")) {
  throw "Transactional inventory migration must sort after POS checkout and void hardening"
}

try {
  $clientContainer = $testContainers[0]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-DeveloperSchema $clientContainer "empty"
  Write-Host "PASS developer credential client-init empty installation"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[1]
  Start-TestContainer $legacyContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -notin @($schemaMigration, $hardeningMigration) })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  $legacyHash = New-ValidCredentialHash
  $legacyFixture = @"
create table public.developer_access (
  id smallint primary key default 1,
  password_hash text not null,
  password_version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint developer_access_singleton_check check (id = 1),
  constraint developer_access_password_hash_not_blank_check check (btrim(password_hash) <> '')
);
insert into public.developer_access(id, password_hash, password_version) values (1, '$legacyHash', 1);
update public.business_settings set business_name = 'LEGACY_SHARED_SAFE';
update public.feature_settings set updated_by = 'LEGACY_SHARED_SAFE';
update public.legal_settings set updated_by = 'LEGACY_SHARED_SAFE';
"@
  Invoke-SqlText $legacyContainer $legacyFixture "legacy shared credential fixture"
  Invoke-SqlFile $legacyContainer (Join-Path $migrationsDirectory $hardeningMigration)
  Assert-DeveloperSchema $legacyContainer "must-rotate" "LEGACY_SHARED_SAFE"
  Write-Host "PASS fixed legacy credential upgrade requires rotation without data loss"
  Remove-TestContainer $legacyContainer

  $uniqueContainer = $testContainers[2]
  Start-TestContainer $uniqueContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -ne $hardeningMigration })) {
    Invoke-SqlFile $uniqueContainer $migration.FullName
  }
  $uniqueHash = New-ValidCredentialHash
  $oldVersion = [guid]::NewGuid().ToString()
  $uniqueFixture = @"
insert into public.developer_access(id, password_hash, password_version, credential_version, initialized_at, must_rotate, updated_at)
values (1, '$uniqueHash', 7, '$oldVersion', now(), false, now());
update public.business_settings set business_name = 'UNIQUE_EXISTING_SAFE';
update public.feature_settings set updated_by = 'UNIQUE_EXISTING_SAFE';
update public.legal_settings set updated_by = 'UNIQUE_EXISTING_SAFE';
"@
  Invoke-SqlText $uniqueContainer $uniqueFixture "existing unique credential fixture"
  Invoke-SqlFile $uniqueContainer (Join-Path $migrationsDirectory $hardeningMigration)
  Assert-DeveloperSchema $uniqueContainer "must-rotate" "UNIQUE_EXISTING_SAFE"
  $versionAssertion = "do `$`$ begin if not exists (select 1 from public.developer_access where password_version = 7 and credential_version <> '$oldVersion'::uuid) then raise exception 'existing unique credential version was not invalidated'; end if; end; `$`$;"
  Invoke-SqlText $uniqueContainer $versionAssertion "unique credential invalidation assertion"
  Write-Host "PASS existing unique credential upgrade also requires rotation without data loss"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
