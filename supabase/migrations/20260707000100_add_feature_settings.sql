begin;

create table if not exists public.feature_settings (
  id smallint primary key default 1,
  plan text not null default 'advanced',
  features jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_settings_singleton_check check (id = 1),
  constraint feature_settings_plan_check check (plan in ('basic', 'standard', 'advanced', 'custom')),
  constraint feature_settings_features_object_check check (jsonb_typeof(features) = 'object')
);

insert into public.feature_settings (id, plan, features, updated_by)
values (
  1,
  'advanced',
  '{
    "storefront": true,
    "product_management": true,
    "inventory": true,
    "pos_checkout": true,
    "pos_orders": true,
    "pos_void": true,
    "pos_reports": true,
    "receipt_printing": true,
    "barcode_labels": true,
    "csv_import": true,
    "skroutz_feed": true,
    "staff_accounts": true,
    "ai_tools": true,
    "backup_tools": true
  }'::jsonb,
  'migration'
)
on conflict (id) do nothing;

alter table public.feature_settings enable row level security;

revoke all on table public.feature_settings from anon, authenticated;
grant select, insert, update, delete on table public.feature_settings to service_role;

commit;
