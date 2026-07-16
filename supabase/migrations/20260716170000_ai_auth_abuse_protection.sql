begin;

create table if not exists public.security_rate_limit_buckets (
  namespace text not null,
  dimension text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (namespace, dimension, subject_hash, window_started_at),
  constraint security_rate_limit_count_check check (request_count >= 0),
  constraint security_rate_limit_subject_check check (btrim(subject_hash) <> '')
);

create index if not exists security_rate_limit_updated_idx
  on public.security_rate_limit_buckets (updated_at);

create table if not exists public.ai_usage_daily (
  usage_date date not null,
  store_key text not null,
  request_count integer not null default 0,
  input_characters bigint not null default 0,
  output_characters bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (usage_date, store_key),
  constraint ai_usage_daily_store_check check (btrim(store_key) <> ''),
  constraint ai_usage_daily_counts_check check (
    request_count >= 0 and input_characters >= 0 and output_characters >= 0
  )
);

create table if not exists public.ai_request_leases (
  request_id uuid primary key,
  store_key text not null,
  status text not null default 'active',
  input_characters integer not null default 0,
  output_characters integer not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_request_lease_store_check check (btrim(store_key) <> ''),
  constraint ai_request_lease_status_check check (status in ('active', 'completed', 'failed', 'expired')),
  constraint ai_request_lease_character_check check (input_characters >= 0 and output_characters >= 0)
);

create index if not exists ai_request_leases_active_idx
  on public.ai_request_leases (store_key, expires_at)
  where status = 'active';

create index if not exists ai_request_leases_updated_idx
  on public.ai_request_leases (updated_at);

create table if not exists public.security_auth_limits (
  namespace text not null,
  subject_hash text not null,
  window_started_at timestamptz not null default now(),
  failed_count integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (namespace, subject_hash),
  constraint security_auth_namespace_check check (btrim(namespace) <> ''),
  constraint security_auth_subject_check check (btrim(subject_hash) <> ''),
  constraint security_auth_failed_count_check check (failed_count >= 0)
);

create index if not exists security_auth_limits_updated_idx
  on public.security_auth_limits (updated_at);

alter table public.security_rate_limit_buckets enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.ai_request_leases enable row level security;
alter table public.security_auth_limits enable row level security;

revoke all on table public.security_rate_limit_buckets from public, anon, authenticated;
revoke all on table public.ai_usage_daily from public, anon, authenticated;
revoke all on table public.ai_request_leases from public, anon, authenticated;
revoke all on table public.security_auth_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.security_rate_limit_buckets to service_role;
grant select, insert, update, delete on table public.ai_usage_daily to service_role;
grant select, insert, update, delete on table public.ai_request_leases to service_role;
grant select, insert, update, delete on table public.security_auth_limits to service_role;

create or replace function public.ai_rate_limit_begin_rpc(
  p_request_id uuid,
  p_store_key text,
  p_subjects jsonb,
  p_limits jsonb,
  p_daily_limit integer,
  p_concurrency_limit integer,
  p_input_characters integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz := pg_catalog.date_trunc('minute', v_now);
  v_today date := (v_now at time zone 'utc')::date;
  v_dimension text;
  v_subject text;
  v_limit integer;
  v_count integer;
  v_daily_count integer;
  v_active_count integer;
begin
  if p_request_id is null
     or p_store_key is null or pg_catalog.btrim(p_store_key) = ''
     or p_subjects is null or pg_catalog.jsonb_typeof(p_subjects) <> 'object'
     or p_limits is null or pg_catalog.jsonb_typeof(p_limits) <> 'object'
     or p_daily_limit < 1 or p_concurrency_limit < 1
     or p_input_characters < 0 or p_input_characters > 65536 then
    raise exception 'AI_SECURITY_INVALID_INPUT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-security:' || p_store_key, 0));

  if exists (select 1 from public.ai_request_leases where request_id = p_request_id) then
    return pg_catalog.jsonb_build_object('allowed', false, 'code', 'AI_REQUEST_ALREADY_STARTED', 'retry_after', 0);
  end if;

  update public.ai_request_leases
  set status = 'expired', finished_at = v_now, updated_at = v_now
  where store_key = p_store_key and status = 'active' and expires_at <= v_now;

  for v_dimension, v_subject in
    select key, value from pg_catalog.jsonb_each_text(p_subjects)
  loop
    v_limit := nullif(p_limits ->> v_dimension, '')::integer;
    if v_limit is null or v_limit < 1 or pg_catalog.btrim(v_subject) = '' then
      raise exception 'AI_SECURITY_INVALID_LIMIT';
    end if;
    select request_count into v_count
    from public.security_rate_limit_buckets
    where namespace = 'ai-assistant'
      and dimension = v_dimension
      and subject_hash = v_subject
      and window_started_at = v_window;
    if coalesce(v_count, 0) >= v_limit then
      return pg_catalog.jsonb_build_object(
        'allowed', false,
        'code', 'AI_RATE_LIMITED',
        'dimension', v_dimension,
        'retry_after', greatest(1, 60 - extract(second from v_now)::integer)
      );
    end if;
  end loop;

  insert into public.ai_usage_daily(usage_date, store_key)
  values (v_today, p_store_key)
  on conflict (usage_date, store_key) do nothing;

  select request_count into v_daily_count
  from public.ai_usage_daily
  where usage_date = v_today and store_key = p_store_key
  for update;
  if v_daily_count >= p_daily_limit then
    return pg_catalog.jsonb_build_object('allowed', false, 'code', 'AI_DAILY_BUDGET_EXHAUSTED', 'retry_after', 3600);
  end if;

  select pg_catalog.count(*)::integer into v_active_count
  from public.ai_request_leases
  where store_key = p_store_key and status = 'active' and expires_at > v_now;
  if v_active_count >= p_concurrency_limit then
    return pg_catalog.jsonb_build_object('allowed', false, 'code', 'AI_CONCURRENCY_LIMIT', 'retry_after', 2);
  end if;

  for v_dimension, v_subject in
    select key, value from pg_catalog.jsonb_each_text(p_subjects)
  loop
    insert into public.security_rate_limit_buckets(
      namespace, dimension, subject_hash, window_started_at, request_count, updated_at
    ) values ('ai-assistant', v_dimension, v_subject, v_window, 1, v_now)
    on conflict (namespace, dimension, subject_hash, window_started_at)
    do update set request_count = security_rate_limit_buckets.request_count + 1, updated_at = excluded.updated_at;
  end loop;

  update public.ai_usage_daily
  set request_count = request_count + 1,
      input_characters = input_characters + p_input_characters,
      updated_at = v_now
  where usage_date = v_today and store_key = p_store_key;

  insert into public.ai_request_leases(
    request_id, store_key, status, input_characters, expires_at, updated_at
  ) values (p_request_id, p_store_key, 'active', p_input_characters, v_now + interval '60 seconds', v_now);

  delete from public.security_rate_limit_buckets where updated_at < v_now - interval '2 days';
  return pg_catalog.jsonb_build_object('allowed', true, 'code', 'OK', 'retry_after', 0);
end;
$$;

create or replace function public.ai_rate_limit_finish_rpc(
  p_request_id uuid,
  p_status text,
  p_output_characters integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_store_key text;
  v_usage_date date;
begin
  if p_request_id is null or p_status not in ('completed', 'failed')
     or p_output_characters < 0 or p_output_characters > 65536 then
    raise exception 'AI_SECURITY_INVALID_FINISH';
  end if;

  update public.ai_request_leases
  set status = p_status,
      output_characters = p_output_characters,
      finished_at = v_now,
      expires_at = v_now,
      updated_at = v_now
  where request_id = p_request_id and status = 'active'
  returning store_key, (started_at at time zone 'utc')::date into v_store_key, v_usage_date;
  if not found then return false; end if;

  update public.ai_usage_daily
  set output_characters = output_characters + p_output_characters, updated_at = v_now
  where usage_date = v_usage_date and store_key = v_store_key;

  delete from public.ai_request_leases where updated_at < v_now - interval '7 days';
  return true;
end;
$$;

create or replace function public.auth_rate_limit_status_rpc(
  p_namespace text,
  p_subject_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_blocked_until timestamptz;
begin
  if p_namespace is null or pg_catalog.btrim(p_namespace) = ''
     or p_subject_hash is null or pg_catalog.btrim(p_subject_hash) = '' then
    raise exception 'AUTH_SECURITY_INVALID_INPUT';
  end if;
  select blocked_until into v_blocked_until
  from public.security_auth_limits
  where namespace = p_namespace and subject_hash = p_subject_hash;
  if v_blocked_until is not null and v_blocked_until > v_now then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(1, pg_catalog.ceil(extract(epoch from (v_blocked_until - v_now)))::integer)
    );
  end if;
  return pg_catalog.jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

create or replace function public.auth_rate_limit_record_rpc(
  p_namespace text,
  p_subject_hash text,
  p_success boolean,
  p_max_failures integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_capacity integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.security_auth_limits%rowtype;
  v_count integer;
  v_window_started timestamptz;
  v_blocked_until timestamptz;
begin
  if p_namespace is null or pg_catalog.btrim(p_namespace) = ''
     or p_subject_hash is null or pg_catalog.btrim(p_subject_hash) = ''
     or p_success is null or p_max_failures < 1
     or p_window_seconds < 1 or p_window_seconds > 86400
     or p_block_seconds < 1 or p_block_seconds > 604800
     or p_capacity < 10 or p_capacity > 100000 then
    raise exception 'AUTH_SECURITY_INVALID_INPUT';
  end if;

  -- Serialize each namespace so a distributed attacker cannot bypass the
  -- bounded audit capacity by racing many previously unseen subjects.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('auth-security-namespace:' || p_namespace, 0)
  );

  if p_success then
    delete from public.security_auth_limits where namespace = p_namespace and subject_hash = p_subject_hash;
    return pg_catalog.jsonb_build_object('allowed', true, 'retry_after', 0);
  end if;

  select * into v_row
  from public.security_auth_limits
  where namespace = p_namespace and subject_hash = p_subject_hash;

  delete from public.security_auth_limits where updated_at < v_now - interval '30 days';

  if v_row.namespace is null then
    delete from public.security_auth_limits
    where ctid in (
      select ctid
      from public.security_auth_limits
      where namespace = p_namespace
      order by updated_at desc, subject_hash
      offset greatest(0, p_capacity - 1)
    );
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(1, pg_catalog.ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer)
    );
  end if;

  if v_row.namespace is null or v_row.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) then
    v_count := 1;
    v_window_started := v_now;
  else
    v_count := v_row.failed_count + 1;
    v_window_started := v_row.window_started_at;
  end if;
  v_blocked_until := case when v_count >= p_max_failures
    then v_now + pg_catalog.make_interval(secs => p_block_seconds)
    else null end;

  insert into public.security_auth_limits(
    namespace, subject_hash, window_started_at, failed_count, blocked_until, updated_at
  ) values (p_namespace, p_subject_hash, v_window_started, v_count, v_blocked_until, v_now)
  on conflict (namespace, subject_hash) do update set
    window_started_at = excluded.window_started_at,
    failed_count = excluded.failed_count,
    blocked_until = excluded.blocked_until,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'allowed', v_blocked_until is null,
    'retry_after', case when v_blocked_until is null then 0 else p_block_seconds end
  );
end;
$$;

revoke all on function public.ai_rate_limit_begin_rpc(uuid, text, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_rate_limit_finish_rpc(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.auth_rate_limit_status_rpc(text, text) from public, anon, authenticated;
revoke all on function public.auth_rate_limit_record_rpc(text, text, boolean, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_rate_limit_begin_rpc(uuid, text, jsonb, jsonb, integer, integer, integer) to service_role;
grant execute on function public.ai_rate_limit_finish_rpc(uuid, text, integer) to service_role;
grant execute on function public.auth_rate_limit_status_rpc(text, text) to service_role;
grant execute on function public.auth_rate_limit_record_rpc(text, text, boolean, integer, integer, integer, integer) to service_role;

update public.admin_users set email = pg_catalog.lower(pg_catalog.btrim(email));

do $$
begin
  if exists (
    select pg_catalog.lower(pg_catalog.btrim(email))
    from public.admin_users
    group by pg_catalog.lower(pg_catalog.btrim(email))
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'ADMIN_USER_EMAIL_CONFLICT: resolve duplicate case-insensitive emails before this migration';
  end if;
end;
$$;

drop index if exists public.admin_users_email_idx;
create unique index admin_users_email_ci_unique_idx
  on public.admin_users (pg_catalog.lower(pg_catalog.btrim(email)));

alter table public.admin_users
  drop constraint if exists admin_users_email_normalized_check;
alter table public.admin_users
  add constraint admin_users_email_normalized_check
  check (email = pg_catalog.lower(pg_catalog.btrim(email)) and position('@' in email) > 1);

revoke all on table public.admin_users from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;

commit;
