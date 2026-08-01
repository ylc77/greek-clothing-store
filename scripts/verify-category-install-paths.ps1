$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot "supabase\migrations\20260802103000_repair_legacy_category_timestamps.sql"
$postgresImage = "public.ecr.aws/supabase/postgres:17.6.1.127"
$container = "clothing_category_legacy_upgrade_test"

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Remove-TestContainer {
  $existing = docker ps -a --filter "name=^/$container$" --format "{{.Names}}"
  if ($existing -eq $container) {
    docker rm -f $container | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove test container $container" }
  }
}

function Invoke-SqlText([string]$Sql, [string]$Label) {
  $Sql | docker exec -i $container psql -q -X -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "$Label failed" }
}

function Invoke-SqlFile([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { throw "SQL file not found: $Path" }
  $sql = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Invoke-SqlText $sql (Split-Path -Leaf $Path)
}

try {
  Remove-TestContainer
  docker run -d --name $container -e POSTGRES_PASSWORD=postgres $postgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to start test container $container" }

  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    docker exec $container pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
  } while ((Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw "Timed out waiting for test container $container" }

  $fixture = @'
create table public.product_categories (
  id uuid primary key,
  slug text unique not null,
  name_cn text not null default '',
  name_en text not null default '',
  name_gr text not null default '',
  image_url text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_subcategories (
  id uuid primary key,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  slug text not null,
  name_cn text not null default '',
  name_en text not null default '',
  name_gr text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, slug)
);

insert into public.product_categories (
  id, slug, name_cn, name_en, name_gr, sort_order, is_active, created_at
) values (
  '11111111-1111-4111-8111-111111111111', 'legacy-category', 'Legacy category CN',
  'Legacy category', 'Legacy category GR', 9, true, '2020-01-02T03:04:05Z'
);

insert into public.product_subcategories (
  id, category_id, slug, name_cn, name_en, name_gr, sort_order, is_active, created_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111', 'legacy-subcategory', 'Legacy subcategory CN',
  'Legacy subcategory', 'Legacy subcategory GR', 2, true, '2020-01-02T03:04:05Z'
);
'@
  Invoke-SqlText $fixture "legacy category fixture"
  Invoke-SqlFile $migrationPath
  Invoke-SqlFile $migrationPath

  $assertions = @'
do $$
declare
  v_category_before timestamptz;
  v_subcategory_before timestamptz;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('product_categories', 'product_subcategories')
      and column_name = 'updated_at'
      and (is_nullable <> 'NO' or column_default is null)
  ) then raise exception 'updated_at is nullable or lacks a default'; end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name in ('product_categories', 'product_subcategories')
        and column_name = 'updated_at') <> 2 then
    raise exception 'category updated_at columns are incomplete';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'categories_updated_at' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'subcategories_updated_at' and not tgisinternal) then
    raise exception 'category updated_at trigger is missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.set_updated_at()'::regprocedure
      and proconfig @> array['search_path=""']
  ) then raise exception 'set_updated_at does not use an empty search_path'; end if;

  select updated_at into v_category_before
  from public.product_categories where slug = 'legacy-category';
  select updated_at into v_subcategory_before
  from public.product_subcategories where slug = 'legacy-subcategory';

  if v_category_before <> '2020-01-02T03:04:05Z'::timestamptz
     or v_subcategory_before <> '2020-01-02T03:04:05Z'::timestamptz then
    raise exception 'legacy timestamps were not preserved';
  end if;

  perform pg_sleep(0.01);
  update public.product_categories set name_en = 'Updated legacy category' where slug = 'legacy-category';
  update public.product_subcategories set name_en = 'Updated legacy subcategory' where slug = 'legacy-subcategory';

  if not exists (
    select 1 from public.product_categories
    where slug = 'legacy-category'
      and name_cn = 'Legacy category CN'
      and name_en = 'Updated legacy category'
      and name_gr = 'Legacy category GR'
      and updated_at > v_category_before
  ) then raise exception 'legacy category data or trigger result is incorrect'; end if;

  if not exists (
    select 1 from public.product_subcategories
    where slug = 'legacy-subcategory'
      and name_cn = 'Legacy subcategory CN'
      and name_en = 'Updated legacy subcategory'
      and name_gr = 'Legacy subcategory GR'
      and updated_at > v_subcategory_before
  ) then raise exception 'legacy subcategory data or trigger result is incorrect'; end if;
end;
$$;
'@
  Invoke-SqlText $assertions "legacy category upgrade assertions"
  Write-Host "PASS legacy category upgrade adds timestamps, preserves data, installs triggers and is idempotent"
} finally {
  try { Remove-TestContainer } catch { Write-Warning $_ }
}
