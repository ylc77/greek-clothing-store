$ErrorActionPreference = "Stop"

$container = "supabase_db_clothing_web"
$running = (& docker inspect -f '{{.State.Running}}' $container 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
  throw "Local clothing_web Supabase database is not running."
}

function Invoke-Psql([string]$Sql, [switch]$AllowFailure) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = $Sql | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At -f - 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if (-not $AllowFailure -and $code -ne 0) {
    throw "Local legal publish SQL failed: $($output -join ' ')"
  }
  return @{ Code = $code; Output = $output }
}

$basePayload = '{"businessName":"LEGAL_PUBLISH_TEST","localized":{"el":{},"en":{}}}'

Invoke-Psql @"
truncate table public.legal_settings_versions restart identity;
update public.legal_settings
set draft = '{}'::jsonb,
    is_complete = false,
    current_version_number = null,
    published_at = null,
    published_by = null,
    updated_by = null,
    updated_at = pg_catalog.now()
where id = 1;

do `$block`$
begin
  if pg_catalog.has_function_privilege('anon', 'public.legal_settings_publish_rpc(jsonb,text)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.legal_settings_publish_rpc(jsonb,text)', 'execute') then
    raise exception 'public role can execute legal publish RPC';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.legal_settings_publish_rpc(jsonb,text)', 'execute') then
    raise exception 'service_role cannot execute legal publish RPC';
  end if;
end;
`$block`$;
"@ | Out-Null

Invoke-Psql "set role service_role; select public.legal_settings_publish_rpc('$basePayload'::jsonb, 'legal-test');" | Out-Null

$concurrentSql = @(
  "set role service_role; select public.legal_settings_publish_rpc('{`"businessName`":`"LEGAL_PUBLISH_CONCURRENT_A`"}'::jsonb, 'legal-test-a');",
  "set role service_role; select public.legal_settings_publish_rpc('{`"businessName`":`"LEGAL_PUBLISH_CONCURRENT_B`"}'::jsonb, 'legal-test-b');"
)
$jobs = foreach ($sql in $concurrentSql) {
  Start-Job -ScriptBlock {
    param($Container, $Sql)
    $Sql | & docker exec -i $Container psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -At -f -
    if ($LASTEXITCODE -ne 0) { throw "Concurrent legal publish failed" }
  } -ArgumentList $container, $sql
}
$jobs | Wait-Job | Out-Null
foreach ($job in $jobs) {
  Receive-Job $job | Out-Null
  if ($job.State -ne "Completed") { throw "Concurrent legal publish Job did not complete." }
  Remove-Job $job
}

Invoke-Psql @"
do `$block`$
declare
  version_count integer;
  current_count integer;
  current_version integer;
begin
  select pg_catalog.count(*), pg_catalog.count(*) filter (where is_current)
    into version_count, current_count
  from public.legal_settings_versions;
  select current_version_number into current_version from public.legal_settings where id = 1;
  if version_count <> 3 or current_count <> 1 or current_version <> 3 then
    raise exception 'concurrent publish state is inconsistent: versions %, current rows %, current version %', version_count, current_count, current_version;
  end if;
end;
`$block`$;

create or replace function public.legal_publish_test_fail_trigger()
returns trigger language plpgsql set search_path = '' as `$fn`$
begin
  if new.draft ->> 'force_fail' = 'true' then
    raise exception 'LEGAL_PUBLISH_TEST_FAILURE';
  end if;
  return new;
end;
`$fn`$;

drop trigger if exists legal_publish_test_fail on public.legal_settings;
create trigger legal_publish_test_fail
before insert or update on public.legal_settings
for each row execute function public.legal_publish_test_fail_trigger();
"@ | Out-Null

$failed = Invoke-Psql "set role service_role; select public.legal_settings_publish_rpc('{`"force_fail`":`"true`"}'::jsonb, 'legal-test-failure');" -AllowFailure
if ($failed.Code -eq 0) { throw "Fault injection unexpectedly succeeded." }

Invoke-Psql @"
do `$block`$
declare
  version_count integer;
  current_count integer;
  current_version integer;
begin
  select pg_catalog.count(*), pg_catalog.count(*) filter (where is_current)
    into version_count, current_count
  from public.legal_settings_versions;
  select current_version_number into current_version from public.legal_settings where id = 1;
  if version_count <> 3 or current_count <> 1 or current_version <> 3 then
    raise exception 'failed publish was not fully rolled back';
  end if;
end;
`$block`$;

drop trigger if exists legal_publish_test_fail on public.legal_settings;
drop function if exists public.legal_publish_test_fail_trigger();
truncate table public.legal_settings_versions restart identity;
update public.legal_settings
set draft = '{}'::jsonb,
    is_complete = false,
    current_version_number = null,
    published_at = null,
    published_by = null,
    updated_by = null,
    updated_at = pg_catalog.now()
where id = 1;
"@ | Out-Null

Write-Host "PASS legal publish RPC permissions, concurrency, rollback, and cleanup"
