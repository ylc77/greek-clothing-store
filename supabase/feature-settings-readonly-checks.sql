-- This file is read-only. Only SELECT statements are allowed.

-- 1. feature_settings table exists in public.
select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'feature_settings';

-- Expected: exactly one row.

-- 2. Required columns and data types.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'feature_settings'
order by ordinal_position;

-- Expected columns: id, plan, features, updated_by, created_at, updated_at.

-- 3. RLS is enabled.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'feature_settings';

-- Expected: rls_enabled = true.

-- 4. No public RLS policy exists for browser roles.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'feature_settings';

-- Expected: 0 rows.

-- 5. Table privileges by role.
select
  role_name,
  has_table_privilege(role_name, 'public.feature_settings', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.feature_settings', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.feature_settings', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.feature_settings', 'DELETE') as can_delete
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
order by role_name;

-- Expected: anon/authenticated all false; service_role all true.

-- 6. Singleton row and plan value.
select
  id,
  plan,
  jsonb_typeof(features) as features_type,
  updated_by,
  created_at,
  updated_at
from public.feature_settings;

-- Expected: exactly one row, id = 1, plan is basic/standard/advanced/custom,
-- and features_type = object.

-- 7. Required feature keys are present and boolean.
select required.feature_key
from (
  values
    ('storefront'),
    ('product_management'),
    ('inventory'),
    ('pos_checkout'),
    ('pos_orders'),
    ('pos_void'),
    ('pos_reports'),
    ('receipt_printing'),
    ('barcode_labels'),
    ('csv_import'),
    ('skroutz_feed'),
    ('staff_accounts'),
    ('ai_tools'),
    ('backup_tools')
) as required(feature_key)
cross join public.feature_settings fs
where not (fs.features ? required.feature_key)
   or jsonb_typeof(fs.features -> required.feature_key) <> 'boolean';

-- Expected: 0 rows.

-- 8. Unknown feature keys.
select key as unknown_feature_key
from public.feature_settings fs
cross join lateral jsonb_object_keys(fs.features) as keys(key)
where key not in (
  'storefront',
  'product_management',
  'inventory',
  'pos_checkout',
  'pos_orders',
  'pos_void',
  'pos_reports',
  'receipt_printing',
  'barcode_labels',
  'csv_import',
  'skroutz_feed',
  'staff_accounts',
  'ai_tools',
  'backup_tools'
);

-- Expected: 0 rows.
