begin;

create table if not exists public.legal_settings (
  id smallint primary key default 1,
  draft jsonb not null default '{}'::jsonb,
  is_complete boolean not null default false,
  current_version_number integer,
  published_at timestamptz,
  published_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint legal_settings_singleton_check check (id = 1),
  constraint legal_settings_draft_object_check check (jsonb_typeof(draft) = 'object'),
  constraint legal_settings_version_positive_check check (current_version_number is null or current_version_number > 0)
);

create table if not exists public.legal_settings_versions (
  id bigint generated always as identity primary key,
  version_number integer not null unique,
  version_label text not null unique,
  snapshot jsonb not null,
  is_current boolean not null default false,
  published_at timestamptz not null default now(),
  published_by text,
  created_at timestamptz not null default now(),
  constraint legal_settings_versions_number_positive_check check (version_number > 0),
  constraint legal_settings_versions_label_check check (version_label = 'v' || version_number::text),
  constraint legal_settings_versions_snapshot_object_check check (jsonb_typeof(snapshot) = 'object')
);

create unique index if not exists legal_settings_versions_one_current_idx
  on public.legal_settings_versions (is_current)
  where is_current = true;

create index if not exists legal_settings_versions_published_at_idx
  on public.legal_settings_versions (published_at desc);

insert into public.legal_settings (id, draft, is_complete)
values (1, '{}'::jsonb, false)
on conflict (id) do nothing;

alter table public.legal_settings enable row level security;
alter table public.legal_settings_versions enable row level security;

revoke all on table public.legal_settings from anon, authenticated;
revoke all on table public.legal_settings_versions from anon, authenticated;

grant select, insert, update, delete on table public.legal_settings to service_role;
grant select, insert, update, delete on table public.legal_settings_versions to service_role;
grant usage, select on sequence public.legal_settings_versions_id_seq to service_role;

grant select on table public.legal_settings_versions to anon, authenticated;

drop policy if exists "Public can read current legal settings version" on public.legal_settings_versions;
create policy "Public can read current legal settings version"
  on public.legal_settings_versions
  for select
  to anon, authenticated
  using (is_current = true);

alter table public.sales_orders
  add column if not exists legal_terms_version text,
  add column if not exists privacy_policy_version text,
  add column if not exists legal_accepted_at timestamptz;

commit;
