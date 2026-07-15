begin;

create extension if not exists pgcrypto;

create table if not exists public.developer_access (
  id smallint primary key default 1,
  password_hash text not null,
  password_version integer not null default 1,
  credential_version uuid not null default gen_random_uuid(),
  initialized_at timestamptz not null default now(),
  rotated_at timestamptz,
  must_rotate boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint developer_access_singleton_check check (id = 1),
  constraint developer_access_password_hash_not_blank_check check (btrim(password_hash) <> '')
);

alter table public.developer_access
  add column if not exists password_version integer not null default 1,
  add column if not exists credential_version uuid not null default gen_random_uuid(),
  add column if not exists initialized_at timestamptz not null default now(),
  add column if not exists rotated_at timestamptz,
  add column if not exists must_rotate boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.developer_credential_hash_is_valid(p_password_hash text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    pg_catalog.length(p_password_hash) between 128 and 512
    and p_password_hash ~ '^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]{86}==$'
    and pg_catalog.length(pg_catalog.split_part(p_password_hash, '$', 5)) between 24 and 88
    and pg_catalog.length(pg_catalog.split_part(p_password_hash, '$', 5)) % 4 = 0
    and pg_catalog.length(pg_catalog.split_part(p_password_hash, '$', 6)) = 88;
$$;

-- Invalid legacy rows cannot be verified safely. Removing only the credential
-- fails closed and allows service-role bootstrap recovery without touching any
-- Store, Legal, Feature, product, order, or inventory data.
delete from public.developer_access
where not public.developer_credential_hash_is_valid(password_hash);

-- Every pre-existing credential is treated as potentially shared. Its old
-- password and all old cookies remain blocked until the trusted CLI rotates it.
update public.developer_access
set
  credential_version = gen_random_uuid(),
  initialized_at = coalesce(initialized_at, updated_at, now()),
  must_rotate = true,
  updated_at = now();

alter table public.developer_access
  drop constraint if exists developer_access_password_hash_format_check;
alter table public.developer_access
  add constraint developer_access_password_hash_format_check
  check (public.developer_credential_hash_is_valid(password_hash));

alter table public.developer_access
  drop constraint if exists developer_access_password_version_check;
alter table public.developer_access
  add constraint developer_access_password_version_check
  check (password_version >= 1);

alter table public.developer_access enable row level security;
revoke all on table public.developer_access from public, anon, authenticated;
grant select, insert, update, delete on table public.developer_access to service_role;

create or replace function public.developer_credential_bootstrap_rpc(
  p_password_hash text,
  p_credential_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_inserted integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not public.developer_credential_hash_is_valid(p_password_hash) then
    raise exception 'DEV_CREDENTIAL_INVALID_HASH: a bounded scrypt credential is required';
  end if;
  if p_credential_version is null then
    raise exception 'DEV_CREDENTIAL_INVALID_ARGUMENT: credential version is required';
  end if;

  insert into public.developer_access (
    id,
    password_hash,
    password_version,
    credential_version,
    initialized_at,
    rotated_at,
    must_rotate,
    updated_at
  ) values (
    1,
    p_password_hash,
    1,
    p_credential_version,
    v_now,
    null,
    false,
    v_now
  )
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception 'DEV_CREDENTIAL_ALREADY_INITIALIZED: bootstrap refused';
  end if;

  return pg_catalog.jsonb_build_object(
    'initialized', true,
    'mustRotate', false
  );
end;
$$;

create or replace function public.developer_credential_rotate_rpc(
  p_password_hash text,
  p_credential_version uuid,
  p_expected_credential_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_existing public.developer_access%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not public.developer_credential_hash_is_valid(p_password_hash) then
    raise exception 'DEV_CREDENTIAL_INVALID_HASH: a bounded scrypt credential is required';
  end if;
  if p_credential_version is null or p_expected_credential_version is null then
    raise exception 'DEV_CREDENTIAL_INVALID_ARGUMENT: credential versions are required';
  end if;

  select *
    into v_existing
  from public.developer_access
  where id = 1
  for update;

  if not found then
    raise exception 'DEV_CREDENTIAL_UNINITIALIZED: bootstrap is required';
  end if;
  if v_existing.credential_version <> p_expected_credential_version then
    raise exception 'DEV_CREDENTIAL_CONFLICT: credential changed before rotation';
  end if;

  update public.developer_access
  set
    password_hash = p_password_hash,
    password_version = v_existing.password_version + 1,
    credential_version = p_credential_version,
    rotated_at = v_now,
    must_rotate = false,
    updated_at = v_now
  where id = 1;

  if not found then
    raise exception 'DEV_CREDENTIAL_INVARIANT: locked credential disappeared';
  end if;

  return pg_catalog.jsonb_build_object(
    'initialized', true,
    'mustRotate', false
  );
end;
$$;

revoke execute on function public.developer_credential_hash_is_valid(text)
  from public, anon, authenticated;
grant execute on function public.developer_credential_hash_is_valid(text)
  to service_role;

revoke execute on function public.developer_credential_bootstrap_rpc(text, uuid)
  from public, anon, authenticated;
grant execute on function public.developer_credential_bootstrap_rpc(text, uuid)
  to service_role;

revoke execute on function public.developer_credential_rotate_rpc(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.developer_credential_rotate_rpc(text, uuid, uuid)
  to service_role;

comment on table public.developer_access is
  'Private per-customer developer credential. Empty means uninitialized; must_rotate blocks application sessions until trusted CLI rotation.';

commit;
