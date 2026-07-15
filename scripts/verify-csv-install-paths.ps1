$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsDirectory = Join-Path $repoRoot "supabase\migrations"
$clientInitPath = Join-Path $repoRoot "supabase\client-init.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$testContainers = @(
  "clothing_csv_migration_chain_test",
  "clothing_csv_client_init_test",
  "clothing_csv_legacy_upgrade_test"
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

function Assert-CsvSchema([string]$Container, [string]$PathLabel) {
  $assertions = @'
do $$
declare
  signature text;
  function_oid oid;
  table_name text;
begin
  foreach signature in array array[
    'public.product_import_preview_rpc(jsonb)',
    'public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)',
    'public.product_import_apply_row_rpc(uuid,integer,text,text)',
    'public.product_import_refresh_job_rpc(uuid)',
    'public.product_import_reconciliation_rpc(uuid)',
    'public.product_import_runtime_health_rpc()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if function_oid is null then raise exception 'required CSV function is missing: %', signature; end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = function_oid
        and p.prosecdef
        and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
    ) then raise exception 'CSV function security boundary is invalid: %', signature; end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'untrusted role can execute CSV function: %', signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_oid, 'execute') then
      raise exception 'service_role cannot execute CSV function: %', signature;
    end if;
  end loop;

  foreach table_name in array array['product_import_jobs', 'product_import_rows'] loop
    if pg_catalog.to_regclass('public.' || table_name) is null then
      raise exception 'CSV table is missing: %', table_name;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then raise exception 'CSV table RLS is disabled: %', table_name; end if;
    if exists (
      select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = table_name
    ) then raise exception 'CSV table exposes an RLS policy: %', table_name; end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'select')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'insert')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'update')
       or pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'delete')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'select')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'insert')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'update')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'delete') then
      raise exception 'public roles have CSV table access: %', table_name;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'select')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'insert')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'update')
       or not pg_catalog.has_table_privilege('service_role', 'public.' || table_name, 'delete') then
      raise exception 'service_role lacks complete CSV table DML: %', table_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.product_import_rows'::regclass
      and c.contype = 'f'
      and a.attname = 'expected_product_id'
  ) then raise exception 'frozen CSV product identity is still attached to a destructive foreign key'; end if;

  if not coalesce((public.product_import_runtime_health_rpc() ->> 'ready')::boolean, false)
     or not coalesce((public.product_import_runtime_health_rpc() ->> 'main_store_ready')::boolean, false)
     or not coalesce((public.product_import_runtime_health_rpc() ->> 'private_variant_helper_ready')::boolean, false) then
    raise exception 'CSV runtime health is not ready';
  end if;

  if (select count(*) from public.product_import_jobs) <> 0
     or (select count(*) from public.product_import_rows) <> 0 then
    raise exception 'clean CSV installation seeded import history';
  end if;
  if pg_catalog.to_regprocedure('public.product_create_rpc(text,jsonb,jsonb,text,text)') is null
     or pg_catalog.to_regprocedure('public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)') is null
     or pg_catalog.to_regprocedure('public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)') is null then
    raise exception 'CSV installation damaged a prior P1/P2 transaction RPC';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "$PathLabel assertions"
}

function Add-LegacyFixture([string]$Container) {
  $fixture = @'
select public.product_create_rpc(
  'AUDIT-CSV-LEGACY-CREATE-001',
  '{
    "sku":"AUDIT-CSV-LEGACY-001",
    "name_cn":"Legacy CSV product",
    "name_en":"Legacy CSV product",
    "name_gr":"Legacy CSV product",
    "category":"women",
    "subcategory":"dresses",
    "price":19.90,
    "stock":2,
    "sizes":"M",
    "size_stock":{"M":2},
    "image_url":"",
    "image_urls":[],
    "vat":24,
    "is_active":true
  }'::jsonb,
  '[{
    "variant_sku":"AUDIT-CSV-LEGACY-001-M",
    "barcode":"AUDIT-CSV-LEGACY-001-M",
    "size":"M",
    "color":"black",
    "quantity":2,
    "price":19.90,
    "active":true,
    "sort_order":0
  }]'::jsonb,
  'owner:csv-install-path',
  'csv_legacy_fixture'
);
'@
  Invoke-SqlText $Container $fixture "P1 and P2 4A legacy fixture"
}

function Assert-LegacyFixturePreserved([string]$Container) {
  $assertions = @'
do $$
declare
  v_product_id bigint;
  v_variant_id uuid;
begin
  select p.id into v_product_id from public.products p where p.sku = 'AUDIT-CSV-LEGACY-001';
  if v_product_id is null then raise exception 'legacy product disappeared'; end if;
  if not exists (
    select 1 from public.products p
    where p.id = v_product_id and p.stock = 2 and p.size_stock = '{"M":2}'::jsonb and p.create_model_version = 1
  ) then raise exception 'legacy product projection or 4A model version changed'; end if;
  select v.id into v_variant_id from public.product_variants v
  where v.product_id = v_product_id and v.variant_sku = 'AUDIT-CSV-LEGACY-001-M';
  if v_variant_id is null then raise exception 'legacy Variant disappeared'; end if;
  if not exists (
    select 1 from public.inventory_balances b
    where b.variant_id = v_variant_id and b.quantity_on_hand = 2 and b.quantity_reserved = 0
  ) then raise exception 'legacy authoritative balance changed'; end if;
  if (select count(*) from public.stock_movements m where m.variant_id = v_variant_id) <> 1 then
    raise exception 'legacy initial movement count changed';
  end if;
  if not exists (
    select 1 from public.product_operations o
    where o.product_id = v_product_id and o.client_request_id = 'AUDIT-CSV-LEGACY-CREATE-001'
  ) then raise exception 'legacy product operation disappeared'; end if;
  if (select count(*) from public.product_import_jobs) <> 0
     or (select count(*) from public.product_import_rows) <> 0 then
    raise exception 'CSV upgrade fabricated import history';
  end if;
end;
$$;
'@
  Invoke-SqlText $Container $assertions "legacy data preservation assertions"
}

$allMigrations = Get-ChildItem -LiteralPath $migrationsDirectory -Filter "*.sql" -File | Sort-Object Name
$csvMigrations = @($allMigrations | Where-Object { $_.Name -match '^\d+_transactional_csv_import_jobs\.sql$' })
if ($csvMigrations.Count -ne 1) { throw "Expected exactly one *_transactional_csv_import_jobs.sql migration" }
$csvMigration = $csvMigrations[0]
$csvVersion = [Int64]($csvMigration.Name.Split('_')[0])
if ($csvVersion -le 20260715143949) { throw "Transactional CSV migration must sort after P2 4A" }

try {
  $chainContainer = $testContainers[0]
  Start-TestContainer $chainContainer
  foreach ($migration in $allMigrations) { Invoke-SqlFile $chainContainer $migration.FullName }
  Assert-CsvSchema $chainContainer "ordered migration chain empty install"
  Write-Host "PASS ordered migration chain creates CSV schema from an empty database"
  Remove-TestContainer $chainContainer

  $clientContainer = $testContainers[1]
  Start-TestContainer $clientContainer
  Invoke-SqlFile $clientContainer $clientInitPath
  Assert-CsvSchema $clientContainer "CSV client-init empty install"
  Write-Host "PASS CSV client-init empty Supabase installation"
  Remove-TestContainer $clientContainer

  $legacyContainer = $testContainers[2]
  Start-TestContainer $legacyContainer
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -lt $csvMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Add-LegacyFixture $legacyContainer
  Invoke-SqlFile $legacyContainer $csvMigration.FullName
  foreach ($migration in ($allMigrations | Where-Object { $_.Name -gt $csvMigration.Name })) {
    Invoke-SqlFile $legacyContainer $migration.FullName
  }
  Assert-CsvSchema $legacyContainer "P1 and P2 4A legacy CSV upgrade"
  Assert-LegacyFixturePreserved $legacyContainer
  Write-Host "PASS P1 and P2 4A legacy upgrade preserves product, Variant, balance, movement, and operation data"
} finally {
  foreach ($container in $testContainers) {
    try { Remove-TestContainer $container } catch { Write-Warning $_ }
  }
}
