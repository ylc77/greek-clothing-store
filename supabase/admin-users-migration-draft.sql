-- Draft only. Review and run in a test database before production.
-- Formal employee accounts use Supabase Auth users plus public.admin_users.
-- The legacy ADMIN_PASSWORD fallback can stay enabled as an owner emergency path.

begin;

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'staff',
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_role_check check (role in ('owner', 'staff', 'inventory', 'readonly')),
  constraint admin_users_email_not_blank_check check (btrim(email) <> '')
);

create index if not exists admin_users_email_idx
  on public.admin_users (lower(email));

create index if not exists admin_users_role_idx
  on public.admin_users (role);

create index if not exists admin_users_active_idx
  on public.admin_users (active);

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from anon, authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;

commit;
