begin;

create table if not exists public.developer_access (
  id smallint primary key default 1,
  password_hash text not null,
  password_version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint developer_access_singleton_check check (id = 1),
  constraint developer_access_password_hash_not_blank_check check (btrim(password_hash) <> '')
);

alter table public.developer_access enable row level security;

revoke all on table public.developer_access from anon, authenticated;
grant select, insert, update on table public.developer_access to service_role;

insert into public.developer_access (id, password_hash, password_version)
values (
  1,
  'scrypt$16384$8$1$JVBQevdc5mVIsFKfhZYDBQ==$h57PoCu6BNPP/PWRxi3E3vt+eK1secqL+ZALrDolv/Xbn4V344uMobV9VCcVnJZgAmWf9XjJkcAN0KhGsihdBg==',
  1
)
on conflict (id) do nothing;

comment on table public.developer_access is
  'Private developer-only credential hash for Store Settings and Legal Settings. Never expose through anon/authenticated policies.';

commit;
