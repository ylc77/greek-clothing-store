$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$testContainers = @(
  "clothing_public_data_migration_chain_test",
  "clothing_public_data_client_init_test",
  "clothing_public_data_legacy_upgrade_test"
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

function Assert-PublicDataBoundary([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
declare
  allowed_column text;
  restricted_column text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'products'
      and c.relrowsecurity
  ) then raise exception 'products RLS is disabled'; end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'Public read active products'
      and roles @> array['anon'::name]
      and roles @> array['authenticated'::name]
  ) then raise exception 'active public product policy is missing or incorrectly scoped'; end if;

  if pg_catalog.has_table_privilege('anon', 'public.products', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.products', 'select') then
    raise exception 'public role retained table-wide products SELECT';
  end if;

  foreach allowed_column in array array[
    'id', 'sku', 'name_gr', 'name_en', 'description_gr', 'description_en',
    'category', 'subcategory', 'price', 'stock', 'sizes', 'size_system',
    'size_stock', 'image_url', 'image_urls', 'brand', 'ean', 'vat', 'color',
    'additional_image_urls', 'skroutz_url', 'material', 'fit', 'season', 'mpn',
    'availability', 'size_chart', 'fit_type', 'ai_keywords', 'material_verified',
    'category_path_en', 'category_path_gr', 'fiber_composition_gr',
    'fiber_composition_en', 'care_instructions_gr', 'care_instructions_en',
    'country_of_origin', 'manufacturer_name', 'manufacturer_contact',
    'eu_responsible_person', 'product_safety_notes_gr',
    'product_safety_notes_en', 'is_active', 'created_at', 'updated_at'
  ] loop
    if not pg_catalog.has_column_privilege('anon', 'public.products', allowed_column, 'select')
       or not pg_catalog.has_column_privilege('authenticated', 'public.products', allowed_column, 'select') then
      raise exception 'public product column is not readable: %', allowed_column;
    end if;
  end loop;

  foreach restricted_column in array array[
    'name_cn', 'description_cn', 'barcode', 'supplier_id',
    'supplier_style_code', 'metadata_version', 'structure_version',
    'create_model_version'
  ] loop
    if pg_catalog.has_column_privilege('anon', 'public.products', restricted_column, 'select')
       or pg_catalog.has_column_privilege('authenticated', 'public.products', restricted_column, 'select') then
      raise exception 'restricted product column is publicly readable: %', restricted_column;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege('service_role', 'public.products', 'select')
     or not pg_catalog.has_table_privilege('service_role', 'public.products', 'insert')
     or not pg_catalog.has_table_privilege('service_role', 'public.products', 'update')
     or not pg_catalog.has_table_privilege('service_role', 'public.products', 'delete') then
    raise exception 'service_role lacks required products DML';
  end if;

  if pg_catalog.to_regprocedure('public.product_create_rpc(text,jsonb,jsonb,text,text)') is null
     or pg_catalog.to_regprocedure('public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)') is null
     or pg_catalog.to_regprocedure('public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'public boundary installation damaged a prior transaction RPC';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

function Add-LegacyFixture([string]$Container) {
  $fixture = @'
insert into public.suppliers (
  id, code, name, vat_number, contact_name, phone, email, address, country, notes, active
) values (
  'aaaaaaaa-1111-4111-8111-111111111111',
  'AUDIT-PUBLIC-SUP',
  'Private legacy supplier',
  'EL123456789',
  'Private contact',
  '+30 210 0000000',
  'private@example.test',
  'Private address',
  'GR',
  'Private notes',
  true
);

insert into public.products (
  id, sku, name_cn, name_gr, name_en, description_cn, description_gr,
  description_en, category, subcategory, price, stock, sizes, size_stock,
  image_url, image_urls, barcode, supplier_id, supplier_style_code,
  metadata_version, structure_version, create_model_version, is_active
) values (
  920000000001,
  'AUDIT-PUBLIC-LEGACY-001',
  'Private Chinese name',
  'Δοκιμαστικό προϊόν',
  'Legacy public product',
  'Private Chinese description',
  'Δημόσια περιγραφή',
  'Public description',
  'women',
  'dresses',
  29.90,
  2,
  'M',
  '{"M":2}'::jsonb,
  '',
  '[]'::jsonb,
  'INTERNAL-BARCODE-001',
  'aaaaaaaa-1111-4111-8111-111111111111',
  'PRIVATE-STYLE-001',
  7,
  8,
  1,
  true
);

insert into public.product_variants (
  id, product_id, variant_sku, barcode, size, color, price, active, sort_order
) values (
  'bbbbbbbb-2222-4222-8222-222222222222',
  920000000001,
  'AUDIT-PUBLIC-LEGACY-001-M',
  'INTERNAL-BARCODE-001',
  'M',
  null,
  29.90,
  true,
  0
);

insert into public.inventory_balances (
  variant_id, location_id, quantity_on_hand, quantity_reserved
)
select
  'bbbbbbbb-2222-4222-8222-222222222222',
  id,
  2,
  0
from public.inventory_locations
where code = 'MAIN_STORE';
'@
  Invoke-SqlText $Container $fixture "legacy private product fixture"
}

function Assert-LegacyFixturePreserved([string]$Container) {
  $assertions = @'
do $$
begin
  if not exists (
    select 1
    from public.products
    where id = 920000000001
      and sku = 'AUDIT-PUBLIC-LEGACY-001'
      and name_cn = 'Private Chinese name'
      and description_cn = 'Private Chinese description'
      and barcode = 'INTERNAL-BARCODE-001'
      and supplier_id = 'aaaaaaaa-1111-4111-8111-111111111111'
      and supplier_style_code = 'PRIVATE-STYLE-001'
      and metadata_version = 7
      and structure_version = 8
      and create_model_version = 1
      and stock = 2
      and size_stock = '{"M":2}'::jsonb
  ) then raise exception 'legacy private product data changed during boundary upgrade'; end if;

  if not exists (
    select 1
    from public.suppliers
    where id = 'aaaaaaaa-1111-4111-8111-111111111111'
      and vat_number = 'EL123456789'
      and email = 'private@example.test'
      and notes = 'Private notes'
  ) then raise exception 'legacy supplier data changed during boundary upgrade'; end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "legacy private data preservation assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$boundaryMigrations = @($allMigrations | Where-Object { $_.Name -match '^\d+_restrict_public_product_data\.sql$' })
if ($boundaryMigrations.Count -ne 1) { throw "Expected exactly one *_restrict_public_product_data.sql migration" }
$boundaryMigration = $boundaryMigrations[0]
$boundaryVersion = [Int64]($boundaryMigration.Name.Split('_')[0])
if ($boundaryVersion -le 20260716100000) { throw "Public data boundary migration must sort after CSV import" }

try {
  $chainContainer = $testContainers[0]
  Start-TestContainer $chainContainer
  foreach ($migration in $allMigrations) { Invoke-SqlFile $chainContainer $migration.FullName }
  Assert-PublicDataBoundary $chainContainer "ordered migration chain empty install"
  Write-Host "PASS ordered migration chain creates the public product boundary from an empty database"
  Remove-TestContainer $chainContainer

  $clientContainer = $testContainers[1]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-PublicDataBoundary $clientContainer "client-init empty install"
  Write-Host "PASS client-init creates the public product boundary from an empty database"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[2]
  Start-TestContainer $legacyContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $boundaryMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Add-LegacyFixture $legacyContainer
  Invoke-SqlFile $legacyContainer $boundaryMigration.FullName
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -gt $boundaryMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Assert-PublicDataBoundary $legacyContainer "origin-master legacy upgrade"
  Assert-LegacyFixturePreserved $legacyContainer
  Write-Host "PASS origin-master upgrade preserves private product and supplier data while restricting public columns"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
