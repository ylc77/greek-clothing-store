begin;

alter table public.products
  add column if not exists image_width integer,
  add column if not exists image_height integer;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.storage_object_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  client_operation_id uuid not null,
  action text not null,
  status text not null default 'prepared',
  bucket_id text not null default 'product-images',
  object_path text not null,
  owner_type text not null,
  owner_key text not null,
  reason text,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint storage_object_operations_action_check
    check (action in ('upload', 'delete', 'product_delete')),
  constraint storage_object_operations_status_check
    check (status in (
      'prepared', 'storage_ready', 'reference_committed', 'reference_removed',
      'cleanup_pending', 'completed', 'compensated', 'failed', 'cancelled'
    )),
  constraint storage_object_operations_bucket_check
    check (bucket_id = 'product-images'),
  constraint storage_object_operations_owner_type_check
    check (owner_type in ('product', 'business_settings', 'category')),
  constraint storage_object_operations_owner_key_check
    check (btrim(owner_key) <> '' and length(owner_key) <= 200),
  constraint storage_object_operations_path_check
    check (
      btrim(object_path) = object_path
      and object_path <> ''
      and length(object_path) <= 512
      and left(object_path, 1) <> '/'
      and object_path !~ E'\\\\'
      and object_path !~ '(^|/)\.\.?(/|$)'
      and object_path not like '%//%'
    ),
  constraint storage_object_operations_attempt_count_check
    check (attempt_count >= 0),
  constraint storage_object_operations_last_error_check
    check (last_error is null or length(last_error) <= 1000),
  unique (client_operation_id, action, object_path)
);

create index if not exists storage_object_operations_status_created_idx
  on public.storage_object_operations (status, created_at)
  where status in ('prepared', 'storage_ready', 'reference_removed', 'cleanup_pending');

create index if not exists storage_object_operations_owner_idx
  on public.storage_object_operations (owner_type, owner_key, created_at desc);

drop trigger if exists storage_object_operations_updated_at on public.storage_object_operations;
create trigger storage_object_operations_updated_at
before update on public.storage_object_operations
for each row execute function public.set_updated_at();

alter table public.storage_object_operations enable row level security;
revoke all on table public.storage_object_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_object_operations to service_role;

create table if not exists public.product_delete_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  client_operation_id uuid not null unique,
  product_id_snapshot bigint not null,
  sku_snapshot text not null,
  actor text not null,
  status text not null default 'prepared',
  blockers jsonb not null default '{}'::jsonb,
  image_paths jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint product_delete_operations_product_id_check check (product_id_snapshot > 0),
  constraint product_delete_operations_sku_check check (btrim(sku_snapshot) <> '' and length(sku_snapshot) <= 200),
  constraint product_delete_operations_actor_check check (btrim(actor) <> '' and length(actor) <= 200),
  constraint product_delete_operations_status_check check (status in ('prepared', 'blocked', 'database_deleted')),
  constraint product_delete_operations_blockers_check check (jsonb_typeof(blockers) = 'object'),
  constraint product_delete_operations_paths_check check (jsonb_typeof(image_paths) = 'array'),
  constraint product_delete_operations_result_check check (jsonb_typeof(result) = 'object')
);

create index if not exists product_delete_operations_product_idx
  on public.product_delete_operations (product_id_snapshot, created_at desc);

drop trigger if exists product_delete_operations_updated_at on public.product_delete_operations;
create trigger product_delete_operations_updated_at
before update on public.product_delete_operations
for each row execute function public.set_updated_at();

alter table public.product_delete_operations enable row level security;
revoke all on table public.product_delete_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.product_delete_operations to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.product_permanent_delete_prepare_rpc(
  p_product_id bigint,
  p_client_operation_id uuid,
  p_actor text,
  p_storage_paths text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_existing public.product_delete_operations%rowtype;
  v_paths text[] := array[]::text[];
  v_path text;
  v_blockers jsonb;
  v_sales_items bigint;
  v_stock_movements bigint;
  v_inventory_operations bigint;
  v_product_operations bigint;
  v_import_rows bigint;
  v_nonzero_balances bigint;
  v_variant_count bigint;
  v_cleanup jsonb := '[]'::jsonb;
  v_cleanup_id uuid;
  v_result jsonb;
begin
  if p_product_id is null or p_product_id <= 0 then
    raise exception using errcode = '22023', message = 'PRODUCT_ID_INVALID';
  end if;
  if p_client_operation_id is null then
    raise exception using errcode = '22023', message = 'OPERATION_ID_REQUIRED';
  end if;
  if p_actor is null or btrim(p_actor) = '' or length(p_actor) > 200 then
    raise exception using errcode = '22023', message = 'ACTOR_INVALID';
  end if;
  if coalesce(array_length(p_storage_paths, 1), 0) > 100 then
    raise exception using errcode = '22023', message = 'TOO_MANY_STORAGE_PATHS';
  end if;

  select * into v_existing
  from public.product_delete_operations
  where client_operation_id = p_client_operation_id;
  if found then
    if v_existing.product_id_snapshot <> p_product_id then
      raise exception using errcode = '23505', message = 'OPERATION_ID_CONFLICT';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PRODUCT_NOT_FOUND',
      'productId', p_product_id,
      'replayed', false
    );
  end if;

  foreach v_path in array coalesce(p_storage_paths, array[]::text[]) loop
    if v_path is null or btrim(v_path) = '' then
      continue;
    end if;
    if length(v_path) > 512
      or left(v_path, 1) = '/'
      or v_path ~ E'\\\\'
      or v_path ~ '(^|/)\.\.?(/|$)'
      or v_path like '%//%'
      or v_path !~ ('^products/' || p_product_id::text || '/[A-Za-z0-9._-]+/(main|gallery|ai)/[0-9a-fA-F-]{36}\.webp$')
    then
      raise exception using errcode = '22023', message = 'STORAGE_PATH_INVALID';
    end if;
    if not (v_path = any(v_paths)) then
      v_paths := array_append(v_paths, v_path);
    end if;
  end loop;

  insert into public.product_delete_operations (
    client_operation_id, product_id_snapshot, sku_snapshot, actor, status, image_paths
  ) values (
    p_client_operation_id, p_product_id, v_product.sku, btrim(p_actor), 'prepared', to_jsonb(v_paths)
  ) returning * into v_existing;

  select count(*) into v_sales_items
  from public.sales_order_items
  where product_id = p_product_id;

  select count(*) into v_stock_movements
  from public.stock_movements sm
  join public.product_variants pv on pv.id = sm.variant_id
  where pv.product_id = p_product_id;

  select count(*) into v_inventory_operations
  from public.inventory_operations io
  join public.product_variants pv on pv.id = io.variant_id
  where pv.product_id = p_product_id;

  select count(*) into v_product_operations
  from public.product_operations
  where product_id = p_product_id;

  select count(*) into v_import_rows
  from public.product_import_rows
  where product_id = p_product_id or expected_product_id = p_product_id;

  select count(*) into v_nonzero_balances
  from public.inventory_balances ib
  join public.product_variants pv on pv.id = ib.variant_id
  where pv.product_id = p_product_id
    and (ib.quantity_on_hand <> 0 or ib.quantity_reserved <> 0);

  select count(*) into v_variant_count
  from public.product_variants
  where product_id = p_product_id;

  v_blockers := jsonb_build_object(
    'salesOrderItems', v_sales_items,
    'stockMovements', v_stock_movements,
    'inventoryOperations', v_inventory_operations,
    'productOperations', v_product_operations,
    'importRows', v_import_rows,
    'nonzeroBalances', v_nonzero_balances,
    'legacyStock', v_product.stock,
    'variantCount', v_variant_count
  );

  if v_sales_items > 0
    or v_stock_movements > 0
    or v_inventory_operations > 0
    or v_product_operations > 0
    or v_import_rows > 0
    or v_nonzero_balances > 0
    or v_product.stock <> 0
  then
    v_result := jsonb_build_object(
      'ok', false,
      'code', 'PRODUCT_DELETE_BLOCKED',
      'productId', p_product_id,
      'sku', v_product.sku,
      'blockers', v_blockers,
      'replayed', false
    );
    update public.product_delete_operations
    set status = 'blocked', blockers = v_blockers, result = v_result, completed_at = now()
    where id = v_existing.id;
    return v_result;
  end if;

  foreach v_path in array v_paths loop
    insert into public.storage_object_operations (
      client_operation_id, action, status, bucket_id, object_path,
      owner_type, owner_key, reason
    ) values (
      extensions.gen_random_uuid(), 'product_delete', 'prepared', 'product-images', v_path,
      'product', p_product_id::text, 'permanent_product_delete'
    ) returning id into v_cleanup_id;
    v_cleanup := v_cleanup || jsonb_build_array(jsonb_build_object('id', v_cleanup_id, 'path', v_path));
  end loop;

  delete from public.products where id = p_product_id;

  update public.storage_object_operations
  set status = 'reference_removed'
  where owner_type = 'product'
    and owner_key = p_product_id::text
    and action = 'product_delete'
    and status = 'prepared';

  v_result := jsonb_build_object(
    'ok', true,
    'code', 'PRODUCT_DELETED',
    'productId', p_product_id,
    'sku', v_product.sku,
    'cleanup', v_cleanup,
    'replayed', false
  );

  update public.product_delete_operations
  set status = 'database_deleted', blockers = v_blockers, result = v_result, completed_at = now()
  where id = v_existing.id;

  return v_result;
end;
$$;

revoke all on function public.product_permanent_delete_prepare_rpc(bigint, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.product_permanent_delete_prepare_rpc(bigint, uuid, text, text[]) to service_role;

commit;
