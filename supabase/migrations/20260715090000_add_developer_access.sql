begin;

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
  constraint developer_access_password_hash_not_blank_check check (btrim(password_hash) <> ''),
  constraint developer_access_password_version_check check (password_version >= 1),
  constraint developer_access_password_hash_format_check check (
    password_hash ~ '^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]{86}==$'
  )
);

alter table public.developer_access enable row level security;

revoke all on table public.developer_access from public, anon, authenticated;
grant select, insert, update, delete on table public.developer_access to service_role;

comment on table public.developer_access is
  'Private per-customer developer credential. An empty table means uninitialized. Never seed or expose a reusable credential.';

commit;
