$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$testContainers = @(
  "clothing_product_client_init_test",
  "clothing_product_legacy_upgrade_test"
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

function Assert-ProductSchema([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
declare
  signature text;
  function_oid oid;
begin
  if pg_catalog.to_regclass('public.product_operations') is null then
    raise exception 'product_operations is missing';
  end if;
  foreach signature in array array[
    'public.product_create_rpc(text,jsonb,jsonb,text,text)',
    'public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)',
    'public.product_bulk_status_rpc(text,jsonb,text,text)',
    'public.product_runtime_health_rpc()',
    'public.product_reconciliation_rpc()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then raise exception 'required product function is missing: %', signature; end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = function_oid
        and p.prosecdef
        and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
    ) then raise exception 'product function security boundary is invalid: %', signature; end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'untrusted role can execute product function: %', signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
      raise exception 'service_role cannot execute product function: %', signature;
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'product_operations' and c.relrowsecurity
  ) then raise exception 'product_operations RLS is disabled'; end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'product_operations'
  ) then raise exception 'product_operations unexpectedly exposes an RLS policy'; end if;
  if pg_catalog.has_table_privilege('anon', 'public.product_operations', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.product_operations', 'select') then
    raise exception 'public roles can read product_operations';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

function Add-LegacyFixture([string]$Container) {
  $fixture = @'
insert into public.products (
  id, sku, name_cn, name_gr, name_en, category, subcategory, price,
  stock, sizes, size_stock, image_url, image_urls, color, is_active
) values (
  910000000001, 'AUDIT_PRODUCT_LEGACY_001', 'Legacy product', 'Legacy product', 'Legacy product',
  'audit', 'legacy', 19.90, 4, 'M', '{"M":4}'::jsonb, '', '[]'::jsonb, 'black', true
);

insert into public.product_variants (
  id, product_id, variant_sku, barcode, size, color, price, active, sort_order
) values (
  'aaaaaaaa-0000-4000-8000-000000000001', 910000000001,
  'AUDIT_PRODUCT_LEGACY_001-M', 'AUDIT-PRODUCT-LEGACY-001-M', 'M', 'black', 19.90, true, 0
);

insert into public.inventory_balances (
  id, variant_id, location_id, quantity_on_hand, quantity_reserved
)
select
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  id,
  4,
  0
from public.inventory_locations
where code = 'MAIN_STORE';

insert into public.stock_movements (
  id, variant_id, location_id, movement_type, quantity_delta, quantity_before,
  quantity_after, reason, source_type, source_id, idempotency_key, created_by
)
select
  'cccccccc-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  id,
  'initial_migration',
  4,
  0,
  4,
  'P2 legacy upgrade fixture',
  'legacy_fixture',
  'AUDIT_PRODUCT_LEGACY_001',
  'AUDIT_PRODUCT_LEGACY_MOVEMENT_001',
  'audit-product-install-path'
from public.inventory_locations
where code = 'MAIN_STORE';

insert into public.sales_orders (
  id, order_number, status, source, subtotal, discount_total, total, currency,
  payment_status, idempotency_key, created_by, completed_at
) values (
  'dddddddd-0000-4000-8000-000000000001', 'AUDIT-PRODUCT-LEGACY-ORDER-001',
  'completed', 'pos', 19.90, 0, 19.90, 'EUR', 'paid',
  'AUDIT_PRODUCT_LEGACY_ORDER_001', 'audit-product-install-path', now()
);

insert into public.sales_order_items (
  id, order_id, product_id, variant_id, product_sku, variant_sku, barcode,
  name, size, color, quantity, unit_price, discount_total, line_total
) values (
  'eeeeeeee-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001',
  910000000001,
  'aaaaaaaa-0000-4000-8000-000000000001',
  'AUDIT_PRODUCT_LEGACY_001',
  'AUDIT_PRODUCT_LEGACY_001-M',
  'AUDIT-PRODUCT-LEGACY-001-M',
  'Legacy product',
  'M',
  'black',
  1,
  19.90,
  0,
  19.90
);
'@
  Invoke-SqlText $Container $fixture "legacy product inventory and order fixture"
}

function Assert-LegacyFixturePreserved([string]$Container) {
  $assertions = @'
do $$
begin
  if not exists (
    select 1 from public.products
    where id = 910000000001
      and sku = 'AUDIT_PRODUCT_LEGACY_001'
      and stock = 4
      and size_stock = '{"M":4}'::jsonb
  ) then raise exception 'legacy product ID or stock projection changed'; end if;

  if not exists (
    select 1 from public.product_variants
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and product_id = 910000000001
      and variant_sku = 'AUDIT_PRODUCT_LEGACY_001-M'
      and active
  ) then raise exception 'legacy Variant ID or state changed'; end if;

  if not exists (
    select 1 from public.inventory_balances
    where id = 'bbbbbbbb-0000-4000-8000-000000000001'
      and variant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and quantity_on_hand = 4
      and quantity_reserved = 0
  ) then raise exception 'legacy inventory balance ID or quantity changed'; end if;

  if not exists (
    select 1 from public.stock_movements
    where id = 'cccccccc-0000-4000-8000-000000000001'
      and variant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and quantity_delta = 4
      and quantity_before = 0
      and quantity_after = 4
  ) or (select count(*) from public.stock_movements where variant_id = 'aaaaaaaa-0000-4000-8000-000000000001') <> 1 then
    raise exception 'legacy stock movement ID, quantity, or cardinality changed';
  end if;

  if not exists (
    select 1 from public.sales_orders
    where id = 'dddddddd-0000-4000-8000-000000000001'
      and order_number = 'AUDIT-PRODUCT-LEGACY-ORDER-001'
      and status = 'completed'
  ) then raise exception 'legacy order ID or state changed'; end if;

  if not exists (
    select 1 from public.sales_order_items
    where id = 'eeeeeeee-0000-4000-8000-000000000001'
      and order_id = 'dddddddd-0000-4000-8000-000000000001'
      and product_id = 910000000001
      and variant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ) then raise exception 'legacy order item references changed'; end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "legacy data preservation assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$productMigrations = @($allMigrations | Where-Object { $_.Name -match '^\d+_transactional_product_operations\.sql$' })
if ($productMigrations.Count -ne 1) {
  throw "Expected exactly one *_transactional_product_operations.sql migration"
}
$productMigration = $productMigrations[0]
$productVersion = [Int64]($productMigration.Name.Split('_')[0])
if ($productVersion -le 20260715110000) {
  throw "Transactional product migration must sort after 20260715110000_harden_developer_credentials.sql"
}

try {
  $clientContainer = $testContainers[0]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-ProductSchema $clientContainer "product client-init empty install"
  Write-Host "PASS product client-init empty Supabase installation"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[1]
  Start-TestContainer $legacyContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $productMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Add-LegacyFixture $legacyContainer
  Invoke-SqlFile $legacyContainer $productMigration.FullName
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -gt $productMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Assert-ProductSchema $legacyContainer "legacy product database upgrade"
  Assert-LegacyFixturePreserved $legacyContainer
  Write-Host "PASS legacy product upgrade preserves product, Variant, balance, movement, and order IDs"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
