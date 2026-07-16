$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$testContainers = @(
  "clothing_storage_migration_chain_test",
  "clothing_storage_client_init_test",
  "clothing_storage_legacy_upgrade_test"
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

function Assert-StorageBoundary([string]$Container, [string]$Label) {
  $assertions = @'
do $$
declare
  fn_oid oid;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='storage_object_operations' and c.relrowsecurity
  ) then raise exception 'storage_object_operations RLS missing'; end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='product_delete_operations' and c.relrowsecurity
  ) then raise exception 'product_delete_operations RLS missing'; end if;

  if pg_catalog.has_table_privilege('anon','public.storage_object_operations','select')
     or pg_catalog.has_table_privilege('authenticated','public.storage_object_operations','select')
     or pg_catalog.has_table_privilege('anon','public.product_delete_operations','insert')
     or pg_catalog.has_table_privilege('authenticated','public.product_delete_operations','update') then
    raise exception 'public roles can access private lifecycle tables';
  end if;

  if not pg_catalog.has_table_privilege('service_role','public.storage_object_operations','select,insert,update,delete')
     or not pg_catalog.has_table_privilege('service_role','public.product_delete_operations','select,insert,update,delete') then
    raise exception 'service_role lifecycle grants missing';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id='product-images' and public and file_size_limit=10485760
      and allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
      and cardinality(allowed_mime_types)=3
  ) then raise exception 'product-images bucket restrictions missing'; end if;

  fn_oid := pg_catalog.to_regprocedure('public.product_permanent_delete_prepare_rpc(bigint,uuid,text,text[])');
  if fn_oid is null then raise exception 'permanent delete RPC missing'; end if;
  if pg_catalog.has_function_privilege('anon', fn_oid, 'execute')
     or pg_catalog.has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'public role can execute permanent delete RPC';
  end if;
  if not pg_catalog.has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role cannot execute permanent delete RPC';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc where oid=fn_oid and prosecdef
      and 'search_path=""' = any(coalesce(proconfig, array[]::text[]))
  ) then raise exception 'permanent delete RPC security settings invalid'; end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$Label assertions"
}

function Add-LegacyFixture([string]$Container) {
  $fixture = @'
insert into public.products (
  id, sku, name_cn, name_gr, name_en, category, subcategory, price, stock,
  sizes, size_stock, image_url, image_urls, is_active
) values (
  930000000001, 'AUDIT-STORAGE-LEGACY-001', 'Legacy CN', 'Legacy GR', 'Legacy storage product',
  'women', 'dresses', 29.90, 0, '', '{}'::jsonb,
  'https://legacy.example/main.jpg', '["https://legacy.example/detail.jpg"]'::jsonb, true
);
update storage.buckets
set public=true, file_size_limit=null, allowed_mime_types=null
where id='product-images';
'@
  Invoke-SqlText $Container $fixture "legacy storage fixture"
}

function Assert-LegacyPreserved([string]$Container) {
  $assertions = @'
do $$
begin
  if not exists (
    select 1 from public.products
    where id=930000000001 and sku='AUDIT-STORAGE-LEGACY-001'
      and image_url='https://legacy.example/main.jpg'
      and image_urls='["https://legacy.example/detail.jpg"]'::jsonb
  ) then raise exception 'legacy image references changed during upgrade'; end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "legacy image preservation assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$storageMigrations = @($allMigrations | Where-Object { $_.Name -match '^\d+_harden_storage_image_lifecycle\.sql$' })
if ($storageMigrations.Count -ne 1) { throw "Expected one storage lifecycle migration" }
$storageMigration = $storageMigrations[0]
if ([Int64]($storageMigration.Name.Split('_')[0]) -le 20260716113954) { throw "Storage migration must sort after the public boundary" }

try {
  $chain = $testContainers[0]
  Start-TestContainer $chain
  foreach ($migration in $allMigrations) { Invoke-SqlFile $chain $migration.FullName }
  Assert-StorageBoundary $chain "ordered migration chain"
  Write-Host "PASS ordered migration chain installs storage lifecycle security"
  Remove-TestContainer $chain

  $snapshot = $testContainers[1]
  Start-TestContainer $snapshot
  Invoke-SqlFile $snapshot $clientInitPath
  Assert-StorageBoundary $snapshot "client-init"
  Write-Host "PASS client-init installs storage lifecycle security"
  Remove-TestContainer $snapshot

  $legacy = $testContainers[2]
  Start-TestContainer $legacy
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $storageMigration.Name })) {
    Invoke-SqlFile $legacy $migration.FullName
  }
  Add-LegacyFixture $legacy
  Invoke-SqlFile $legacy $storageMigration.FullName
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -gt $storageMigration.Name })) {
    Invoke-SqlFile $legacy $migration.FullName
  }
  Assert-StorageBoundary $legacy "legacy upgrade"
  Assert-LegacyPreserved $legacy
  Write-Host "PASS legacy upgrade preserves product image references and hardens Storage"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
