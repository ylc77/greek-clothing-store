begin;

-- Product metadata and Variant/inventory structure have independent optimistic
-- concurrency versions. Existing rows are legacy rows (create_model_version=0)
-- and are deliberately left otherwise untouched by this forward migration.
alter table public.products
  add column if not exists metadata_version bigint not null default 1,
  add column if not exists structure_version bigint not null default 1,
  add column if not exists create_model_version integer not null default 0;

alter table public.products
  drop constraint if exists products_metadata_version_check,
  drop constraint if exists products_structure_version_check,
  drop constraint if exists products_create_model_version_check;

alter table public.products
  add constraint products_metadata_version_check check (metadata_version >= 1),
  add constraint products_structure_version_check check (structure_version >= 1),
  add constraint products_create_model_version_check check (create_model_version in (0, 1));

-- SKU identity is case-insensitive at every hardened write boundary. These
-- indexes also make direct or future writers preserve the same invariant.
create unique index if not exists products_sku_normalized_unique_idx
on public.products (pg_catalog.lower(pg_catalog.btrim(sku)));

create unique index if not exists product_variants_variant_sku_normalized_unique_idx
on public.product_variants (pg_catalog.lower(pg_catalog.btrim(variant_sku)));

create table if not exists public.product_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_key text not null,
  client_request_id text not null,
  operation_type text not null,
  product_id bigint references public.products(id) on delete restrict,
  payload_fingerprint text not null,
  actor text not null,
  source text not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz not null default pg_catalog.now(),
  constraint product_operations_operation_key_not_blank check (pg_catalog.btrim(operation_key) <> ''),
  constraint product_operations_client_request_id_not_blank check (pg_catalog.btrim(client_request_id) <> ''),
  constraint product_operations_type_check check (operation_type in ('create', 'update', 'bulk_status')),
  constraint product_operations_product_scope_check check (
    (operation_type = 'bulk_status' and product_id is null)
    or (operation_type in ('create', 'update') and product_id is not null)
  ),
  constraint product_operations_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint product_operations_actor_not_blank check (pg_catalog.btrim(actor) <> ''),
  constraint product_operations_source_not_blank check (pg_catalog.btrim(source) <> ''),
  constraint product_operations_result_object_check check (pg_catalog.jsonb_typeof(result) = 'object')
);

-- Keep the migration safe if a development database contains an earlier draft
-- of this unpublished table.
alter table public.product_operations
  alter column product_id drop not null,
  drop constraint if exists product_operations_type_check,
  drop constraint if exists product_operations_product_scope_check;

alter table public.product_operations
  add constraint product_operations_type_check
    check (operation_type in ('create', 'update', 'bulk_status')),
  add constraint product_operations_product_scope_check check (
    (operation_type = 'bulk_status' and product_id is null)
    or (operation_type in ('create', 'update') and product_id is not null)
  );

create unique index if not exists product_operations_operation_key_unique_idx
on public.product_operations (operation_key);

create unique index if not exists product_operations_type_request_unique_idx
on public.product_operations (operation_type, client_request_id);

create index if not exists product_operations_product_created_idx
on public.product_operations (product_id, created_at desc);

alter table public.product_operations enable row level security;
revoke all on table public.product_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.product_operations to service_role;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- PostgreSQL unique indexes can deadlock when two transactions acquire the
-- same set of Variant identities in opposite orders. Lock every new identity,
-- plus the current identities during updates, in one global lexical order
-- before any Variant insert/update reaches a unique index.
create or replace function app_private.product_lock_variant_identities(
  p_variants jsonb,
  p_product_id bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity_key text;
begin
  for v_identity_key in
    with input_rows as (
      select item
      from pg_catalog.jsonb_array_elements(p_variants) as items(item)
    ),
    existing_rows as (
      select pg_catalog.to_jsonb(v) as item
      from public.product_variants v
      where p_product_id is not null and v.product_id = p_product_id
    ),
    variant_rows as (
      select item from input_rows
      union all
      select item from existing_rows
    ),
    identity_keys as (
      select 'variant_sku:' || pg_catalog.lower(pg_catalog.btrim(item ->> 'variant_sku')) as identity_key
      from variant_rows
      where pg_catalog.btrim(coalesce(item ->> 'variant_sku', '')) <> ''
      union
      select 'barcode:' || pg_catalog.btrim(item ->> 'barcode')
      from variant_rows
      where pg_catalog.btrim(coalesce(item ->> 'barcode', '')) <> ''
      union
      select 'supplier_sku:'
        || pg_catalog.btrim(item ->> 'supplier_id')
        || ':'
        || pg_catalog.btrim(item ->> 'supplier_sku')
      from variant_rows
      where pg_catalog.btrim(coalesce(item ->> 'supplier_id', '')) <> ''
        and pg_catalog.btrim(coalesce(item ->> 'supplier_sku', '')) <> ''
    )
    select identity_key
    from identity_keys
    order by identity_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('product:variant_identity:' || v_identity_key, 0)
    );
  end loop;
end;
$$;

revoke all on function app_private.product_lock_variant_identities(jsonb, bigint)
from public, anon, authenticated, service_role;

create or replace function public.product_create_rpc(
  p_client_request_id text,
  p_metadata jsonb,
  p_variants jsonb,
  p_actor text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_sku text;
  v_operation_key text;
  v_fingerprint text;
  v_existing public.product_operations%rowtype;
  v_product_id bigint;
  v_location_id uuid;
  v_variant_item jsonb;
  v_ordinality bigint;
  v_variant_id uuid;
  v_variant_sku text;
  v_barcode text;
  v_size text;
  v_color text;
  v_quantity integer;
  v_sort_order integer;
  v_seen_variant_skus text[] := '{}'::text[];
  v_seen_sizes text[] := '{}'::text[];
  v_stock integer;
  v_sizes text;
  v_size_stock jsonb;
  v_product_json jsonb;
  v_result jsonb;
begin
  if v_client_request_id = '' or pg_catalog.length(v_client_request_id) > 200 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: clientRequestId is required and must be at most 200 characters';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 300 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: actor is required and must be at most 300 characters';
  end if;
  if v_source = '' or pg_catalog.length(v_source) > 500 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: source is required and must be at most 500 characters';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: metadata must be an object';
  end if;
  if p_variants is null
     or pg_catalog.jsonb_typeof(p_variants) <> 'array'
     or pg_catalog.jsonb_array_length(p_variants) = 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variants must be a non-empty array';
  end if;

  v_sku := pg_catalog.btrim(coalesce(p_metadata ->> 'sku', ''));
  if v_sku = '' or pg_catalog.length(v_sku) > 200 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: sku is required and must be at most 200 characters';
  end if;
  if pg_catalog.btrim(coalesce(p_metadata ->> 'category', '')) = '' then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: category is required';
  end if;
  if nullif(p_metadata ->> 'price', '') is null
     or (p_metadata ->> 'price')::numeric < 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: price must be non-negative';
  end if;

  v_operation_key := 'product:create:' || v_client_request_id;
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'operation', 'create',
        'metadata', p_metadata,
        'variants', p_variants,
        'actor', v_actor,
        'source', v_source
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_operation_key, 0));

  select * into v_existing
  from public.product_operations
  where operation_key = v_operation_key;

  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'PRODUCT_OPERATION_CONFLICT: clientRequestId was already used with a different product create payload';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  -- Different request IDs racing to create the same SKU must serialize before
  -- the existence check, so exactly one business result can be created.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product:sku:' || pg_catalog.lower(v_sku), 0)
  );

  if exists (
    select 1
    from public.products
    where pg_catalog.lower(pg_catalog.btrim(sku)) = pg_catalog.lower(v_sku)
  ) then
    raise exception using errcode = 'P0001', message = 'PRODUCT_SKU_CONFLICT: sku already exists';
  end if;

  select id into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE' and active
  limit 1;
  if v_location_id is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_RUNTIME_UNAVAILABLE: MAIN_STORE inventory location is missing or inactive';
  end if;

  perform app_private.product_lock_variant_identities(p_variants, null);

  insert into public.products (
    sku,
    name_cn,
    name_gr,
    name_en,
    description_cn,
    description_gr,
    description_en,
    category,
    subcategory,
    price,
    stock,
    sizes,
    size_stock,
    image_url,
    image_urls,
    image_width,
    image_height,
    brand,
    barcode,
    ean,
    vat,
    color,
    additional_image_urls,
    skroutz_url,
    material,
    fit,
    season,
    mpn,
    availability,
    size_chart,
    size_system,
    fit_type,
    style_tags,
    ai_keywords,
    material_verified,
    category_path_en,
    category_path_gr,
    supplier_id,
    supplier_style_code,
    fiber_composition_gr,
    fiber_composition_en,
    care_instructions_gr,
    care_instructions_en,
    country_of_origin,
    manufacturer_name,
    manufacturer_contact,
    eu_responsible_person,
    product_safety_notes_gr,
    product_safety_notes_en,
    is_active,
    metadata_version,
    structure_version,
    create_model_version
  ) values (
    v_sku,
    coalesce(p_metadata ->> 'name_cn', ''),
    coalesce(p_metadata ->> 'name_gr', ''),
    coalesce(p_metadata ->> 'name_en', ''),
    coalesce(p_metadata ->> 'description_cn', ''),
    coalesce(p_metadata ->> 'description_gr', ''),
    coalesce(p_metadata ->> 'description_en', ''),
    pg_catalog.btrim(p_metadata ->> 'category'),
    coalesce(p_metadata ->> 'subcategory', ''),
    (p_metadata ->> 'price')::numeric,
    0,
    '',
    '{}'::jsonb,
    coalesce(p_metadata ->> 'image_url', ''),
    case
      when pg_catalog.jsonb_typeof(p_metadata -> 'image_urls') = 'array' then p_metadata -> 'image_urls'
      else '[]'::jsonb
    end,
    nullif(p_metadata ->> 'image_width', '')::integer,
    nullif(p_metadata ->> 'image_height', '')::integer,
    coalesce(p_metadata ->> 'brand', ''),
    coalesce(p_metadata ->> 'barcode', ''),
    coalesce(p_metadata ->> 'ean', ''),
    coalesce(nullif(p_metadata ->> 'vat', '')::numeric, 24),
    coalesce(p_metadata ->> 'color', ''),
    coalesce(p_metadata ->> 'additional_image_urls', ''),
    coalesce(p_metadata ->> 'skroutz_url', ''),
    coalesce(p_metadata ->> 'material', ''),
    coalesce(p_metadata ->> 'fit', ''),
    coalesce(p_metadata ->> 'season', ''),
    coalesce(p_metadata ->> 'mpn', ''),
    coalesce(p_metadata ->> 'availability', ''),
    case
      when pg_catalog.jsonb_typeof(p_metadata -> 'size_chart') = 'object' then p_metadata -> 'size_chart'
      else '{}'::jsonb
    end,
    nullif(pg_catalog.btrim(coalesce(p_metadata ->> 'size_system', '')), ''),
    coalesce(nullif(p_metadata ->> 'fit_type', ''), 'regular'),
    case
      when pg_catalog.jsonb_typeof(p_metadata -> 'style_tags') = 'array'
      then array(select pg_catalog.jsonb_array_elements_text(p_metadata -> 'style_tags'))
      else '{}'::text[]
    end,
    case
      when pg_catalog.jsonb_typeof(p_metadata -> 'ai_keywords') = 'array'
      then array(select pg_catalog.jsonb_array_elements_text(p_metadata -> 'ai_keywords'))
      else '{}'::text[]
    end,
    coalesce(nullif(p_metadata ->> 'material_verified', '')::boolean, false),
    coalesce(p_metadata ->> 'category_path_en', ''),
    coalesce(p_metadata ->> 'category_path_gr', ''),
    nullif(pg_catalog.btrim(coalesce(p_metadata ->> 'supplier_id', '')), '')::uuid,
    coalesce(
      p_metadata ->> 'supplier_style_code',
      p_metadata ->> 'supplier_sku',
      ''
    ),
    nullif(p_metadata ->> 'fiber_composition_gr', ''),
    nullif(p_metadata ->> 'fiber_composition_en', ''),
    nullif(p_metadata ->> 'care_instructions_gr', ''),
    nullif(p_metadata ->> 'care_instructions_en', ''),
    nullif(p_metadata ->> 'country_of_origin', ''),
    nullif(p_metadata ->> 'manufacturer_name', ''),
    nullif(p_metadata ->> 'manufacturer_contact', ''),
    nullif(p_metadata ->> 'eu_responsible_person', ''),
    nullif(p_metadata ->> 'product_safety_notes_gr', ''),
    nullif(p_metadata ->> 'product_safety_notes_en', ''),
    coalesce(nullif(p_metadata ->> 'is_active', '')::boolean, true),
    1,
    1,
    1
  )
  returning id into v_product_id;

  for v_variant_item, v_ordinality in
    select item, ordinality
    from pg_catalog.jsonb_array_elements(p_variants) with ordinality as items(item, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_variant_item) <> 'object' then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: every variant must be an object';
    end if;

    v_variant_sku := pg_catalog.btrim(coalesce(v_variant_item ->> 'variant_sku', ''));
    v_barcode := nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'barcode', '')), '');
    v_size := pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v_variant_item ->> 'size', ''), 'ONE SIZE')));
    v_color := pg_catalog.btrim(coalesce(v_variant_item ->> 'color', p_metadata ->> 'color', ''));

    if v_variant_sku = '' or pg_catalog.length(v_variant_sku) > 250 then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: every variant requires a variant_sku of at most 250 characters';
    end if;
    if pg_catalog.lower(v_variant_sku) = any(v_seen_variant_skus) or v_size = any(v_seen_sizes) then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variant_sku and normalized size must be unique within a product catalog';
    end if;
    v_seen_variant_skus := pg_catalog.array_append(v_seen_variant_skus, pg_catalog.lower(v_variant_sku));
    v_seen_sizes := pg_catalog.array_append(v_seen_sizes, v_size);

    if coalesce(v_variant_item ->> 'quantity', '') !~ '^[0-9]+$' then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variant quantity must be a non-negative integer';
    end if;
    v_quantity := (v_variant_item ->> 'quantity')::integer;
    v_sort_order := coalesce(nullif(v_variant_item ->> 'sort_order', '')::integer, (v_ordinality - 1)::integer);

    insert into public.product_variants (
      product_id,
      variant_sku,
      barcode,
      size,
      color,
      cost_price,
      price,
      active,
      sort_order,
      supplier_id,
      supplier_sku,
      reorder_level
    ) values (
      v_product_id,
      v_variant_sku,
      v_barcode,
      v_size,
      v_color,
      nullif(v_variant_item ->> 'cost_price', '')::numeric,
      coalesce(nullif(v_variant_item ->> 'price', '')::numeric, (p_metadata ->> 'price')::numeric),
      true,
      v_sort_order,
      nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_id', '')), '')::uuid,
      nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_sku', '')), ''),
      nullif(v_variant_item ->> 'reorder_level', '')::integer
    )
    returning id into v_variant_id;

    insert into public.inventory_balances (
      variant_id,
      location_id,
      quantity_on_hand,
      quantity_reserved,
      updated_at
    ) values (
      v_variant_id,
      v_location_id,
      v_quantity,
      0,
      pg_catalog.now()
    );

    if v_quantity > 0 then
      insert into public.stock_movements (
        variant_id,
        location_id,
        movement_type,
        quantity_delta,
        quantity_before,
        quantity_after,
        reason,
        source_type,
        source_id,
        idempotency_key,
        created_by
      ) values (
        v_variant_id,
        v_location_id,
        'manual_adjustment',
        v_quantity,
        0,
        v_quantity,
        v_source,
        'product_create',
        v_product_id::text,
        v_operation_key || ':initial:' || v_variant_id::text,
        v_actor
      );
    end if;
  end loop;

  select
    coalesce(pg_catalog.sum(b.quantity_on_hand), 0)::integer,
    coalesce(pg_catalog.string_agg(pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))), ',' order by v.sort_order, v.id), ''),
    coalesce(
      pg_catalog.jsonb_object_agg(
        pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))),
        b.quantity_on_hand
        order by v.sort_order, v.id
      ),
      '{}'::jsonb
    )
  into v_stock, v_sizes, v_size_stock
  from public.product_variants v
  join public.inventory_balances b
    on b.variant_id = v.id and b.location_id = v_location_id
  where v.product_id = v_product_id and v.active;

  update public.products
  set stock = v_stock,
      sizes = v_sizes,
      size_stock = v_size_stock
  where id = v_product_id;

  select pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'variants',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object(
            'quantity_on_hand', coalesce(b.quantity_on_hand, 0),
            'quantity_reserved', coalesce(b.quantity_reserved, 0)
          )
          order by v.sort_order, v.id
        )
        from public.product_variants v
        left join public.inventory_balances b
          on b.variant_id = v.id and b.location_id = v_location_id
        where v.product_id = p.id
      ),
      '[]'::jsonb
    )
  )
  into v_product_json
  from public.products p
  where p.id = v_product_id;

  v_result := pg_catalog.jsonb_build_object('product', v_product_json, 'replayed', false);

  insert into public.audit_logs (
    actor,
    action,
    entity,
    entity_id,
    before,
    after,
    metadata
  ) values (
    v_actor,
    'product_create',
    'product',
    v_product_id::text,
    null,
    v_product_json,
    pg_catalog.jsonb_build_object(
      'operation_key', v_operation_key,
      'source', v_source,
      'metadata_version', 1,
      'structure_version', 1
    )
  );

  -- Keep the operation insert last. Any failure here must roll back the product,
  -- variants, balances, movements, legacy projection, and audit row together.
  insert into public.product_operations (
    operation_key,
    client_request_id,
    operation_type,
    product_id,
    payload_fingerprint,
    actor,
    source,
    result
  ) values (
    v_operation_key,
    v_client_request_id,
    'create',
    v_product_id,
    v_fingerprint,
    v_actor,
    v_source,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.product_runtime_health_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_create_oid oid := pg_catalog.to_regprocedure('public.product_create_rpc(text,jsonb,jsonb,text,text)');
  v_update_oid oid := pg_catalog.to_regprocedure('public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)');
  v_bulk_status_oid oid := pg_catalog.to_regprocedure('public.product_bulk_status_rpc(text,jsonb,text,text)');
  v_operations_ready boolean;
  v_versions_ready boolean;
  v_main_store_ready boolean;
  v_create_ready boolean;
  v_update_ready boolean;
  v_bulk_status_ready boolean;
begin
  v_operations_ready := pg_catalog.to_regclass('public.product_operations') is not null;
  v_versions_ready := exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.products'::pg_catalog.regclass
      and a.attname = 'metadata_version'
      and not a.attisdropped
  ) and exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.products'::pg_catalog.regclass
      and a.attname = 'structure_version'
      and not a.attisdropped
  ) and exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.products'::pg_catalog.regclass
      and a.attname = 'create_model_version'
      and not a.attisdropped
  );
  v_main_store_ready := exists (
    select 1
    from public.inventory_locations
    where code = 'MAIN_STORE' and active
  );
  v_create_ready := v_create_oid is not null
    and pg_catalog.has_function_privilege('service_role', v_create_oid, 'execute');
  v_update_ready := v_update_oid is not null
    and pg_catalog.has_function_privilege('service_role', v_update_oid, 'execute');
  v_bulk_status_ready := v_bulk_status_oid is not null
    and pg_catalog.has_function_privilege('service_role', v_bulk_status_oid, 'execute');

  return pg_catalog.jsonb_build_object(
    'ready', v_operations_ready and v_versions_ready and v_main_store_ready
      and v_create_ready and v_update_ready and v_bulk_status_ready,
    'create_rpc_ready', v_create_ready,
    'update_rpc_ready', v_update_ready,
    'bulk_status_rpc_ready', v_bulk_status_ready,
    'operation_table_ready', v_operations_ready,
    'version_columns_ready', v_versions_ready,
    'main_store_ready', v_main_store_ready,
    'migration_version', '20260715143949'
  );
end;
$$;

create or replace function public.product_reconciliation_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projection_mismatches jsonb;
  v_products_missing_variants jsonb;
  v_variants_missing_balances jsonb;
  v_inactive_with_reserved jsonb;
  v_hardened_missing_create jsonb;
  v_initial_movement_mismatches jsonb;
  v_healthy boolean;
begin
  with expected_projection as (
    select
      p.id as product_id,
      p.sku,
      p.stock as actual_stock,
      p.sizes as actual_sizes,
      p.size_stock as actual_size_stock,
      coalesce((
        select pg_catalog.sum(b.quantity_on_hand)::integer
        from public.product_variants v
        join public.inventory_locations l on l.code = 'MAIN_STORE'
        join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
        where v.product_id = p.id and v.active
      ), 0) as expected_stock,
      coalesce((
        select pg_catalog.string_agg(
          pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))),
          ',' order by v.sort_order, v.id
        )
        from public.product_variants v
        where v.product_id = p.id and v.active
      ), '') as expected_sizes,
      coalesce((
        select pg_catalog.jsonb_object_agg(x.size_label, x.quantity_on_hand order by x.sort_order, x.variant_id)
        from (
          select
            pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))) as size_label,
            b.quantity_on_hand,
            v.sort_order,
            v.id as variant_id
          from public.product_variants v
          join public.inventory_locations l on l.code = 'MAIN_STORE'
          join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
          where v.product_id = p.id and v.active
        ) x
      ), '{}'::jsonb) as expected_size_stock
    from public.products p
  ), mismatches as (
    select *
    from expected_projection
    where actual_stock <> expected_stock
       or actual_sizes <> expected_sizes
       or actual_size_stock <> expected_size_stock
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', product_id,
        'sku', sku,
        'actual_stock', actual_stock,
        'expected_stock', expected_stock,
        'actual_sizes', actual_sizes,
        'expected_sizes', expected_sizes,
        'actual_size_stock', actual_size_stock,
        'expected_size_stock', expected_size_stock
      )
      order by product_id
    ),
    '[]'::jsonb
  ) into v_projection_mismatches
  from mismatches;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('product_id', p.id, 'sku', p.sku)
      order by p.id
    ),
    '[]'::jsonb
  ) into v_products_missing_variants
  from public.products p
  where not exists (
    select 1 from public.product_variants v where v.product_id = p.id
  );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', v.product_id,
        'variant_id', v.id,
        'variant_sku', v.variant_sku
      )
      order by v.product_id, v.id
    ),
    '[]'::jsonb
  ) into v_variants_missing_balances
  from public.product_variants v
  where not exists (
    select 1
    from public.inventory_locations l
    join public.inventory_balances b on b.location_id = l.id
    where l.code = 'MAIN_STORE' and b.variant_id = v.id
  );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', v.product_id,
        'variant_id', v.id,
        'variant_sku', v.variant_sku,
        'quantity_reserved', b.quantity_reserved
      )
      order by v.product_id, v.id
    ),
    '[]'::jsonb
  ) into v_inactive_with_reserved
  from public.product_variants v
  join public.inventory_locations l on l.code = 'MAIN_STORE'
  join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
  where not v.active and b.quantity_reserved <> 0;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('product_id', p.id, 'sku', p.sku)
      order by p.id
    ),
    '[]'::jsonb
  ) into v_hardened_missing_create
  from public.products p
  where p.create_model_version = 1
    and not exists (
      select 1
      from public.product_operations o
      where o.product_id = p.id and o.operation_type = 'create'
    );

  with expected_initial as (
    select
      o.product_id,
      (item ->> 'id')::uuid as variant_id,
      coalesce(nullif(item ->> 'quantity_on_hand', '')::integer, 0) as expected_quantity
    from public.product_operations o
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(o.result #> '{product,variants}', '[]'::jsonb)
    ) as items(item)
    where o.operation_type = 'create'
  ), actual_initial as (
    select
      v.product_id,
      m.variant_id,
      coalesce(pg_catalog.sum(m.quantity_delta), 0)::integer as actual_quantity
    from public.stock_movements m
    join public.product_variants v on v.id = m.variant_id
    where m.source_type = 'product_create'
    group by v.product_id, m.variant_id
  ), mismatch_rows as (
    select
      coalesce(e.product_id, a.product_id) as product_id,
      coalesce(e.variant_id, a.variant_id) as variant_id,
      coalesce(e.expected_quantity, 0) as expected_quantity,
      coalesce(a.actual_quantity, 0) as actual_quantity
    from expected_initial e
    full join actual_initial a
      on a.product_id = e.product_id and a.variant_id = e.variant_id
    where coalesce(e.expected_quantity, 0) <> coalesce(a.actual_quantity, 0)
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', product_id,
        'variant_id', variant_id,
        'expected_quantity', expected_quantity,
        'actual_quantity', actual_quantity
      )
      order by product_id, variant_id
    ),
    '[]'::jsonb
  ) into v_initial_movement_mismatches
  from mismatch_rows;

  v_healthy := pg_catalog.jsonb_array_length(v_projection_mismatches) = 0
    and pg_catalog.jsonb_array_length(v_products_missing_variants) = 0
    and pg_catalog.jsonb_array_length(v_variants_missing_balances) = 0
    and pg_catalog.jsonb_array_length(v_inactive_with_reserved) = 0
    and pg_catalog.jsonb_array_length(v_hardened_missing_create) = 0
    and pg_catalog.jsonb_array_length(v_initial_movement_mismatches) = 0;

  return pg_catalog.jsonb_build_object(
    'healthy', v_healthy,
    'projectionMismatches', v_projection_mismatches,
    'productsMissingVariants', v_products_missing_variants,
    'variantsMissingMainStoreBalances', v_variants_missing_balances,
    'inactiveVariantsWithReserved', v_inactive_with_reserved,
    'hardenedProductsMissingCreateOperation', v_hardened_missing_create,
    'initialMovementMismatches', v_initial_movement_mismatches,
    'checked_at', pg_catalog.now()
  );
end;
$$;

revoke execute on function public.product_create_rpc(text, jsonb, jsonb, text, text)
from public, anon, authenticated;
revoke execute on function public.product_runtime_health_rpc()
from public, anon, authenticated;
revoke execute on function public.product_reconciliation_rpc()
from public, anon, authenticated;

grant execute on function public.product_create_rpc(text, jsonb, jsonb, text, text)
to service_role;
grant execute on function public.product_runtime_health_rpc()
to service_role;
grant execute on function public.product_reconciliation_rpc()
to service_role;

create or replace function public.product_update_rpc(
  p_client_request_id text,
  p_product_id bigint,
  p_expected_metadata_version bigint,
  p_expected_structure_version bigint,
  p_metadata jsonb,
  p_variants jsonb,
  p_actor text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_operation_key text;
  v_fingerprint text;
  v_existing public.product_operations%rowtype;
  v_product public.products%rowtype;
  v_before jsonb;
  v_location_id uuid;
  v_variant_item jsonb;
  v_ordinality bigint;
  v_variant public.product_variants%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_variant_id uuid;
  v_requested_id uuid;
  v_variant_sku text;
  v_barcode text;
  v_size text;
  v_color text;
  v_quantity integer;
  v_expected_on_hand integer;
  v_sort_order integer;
  v_is_existing boolean;
  v_included_ids uuid[] := '{}'::uuid[];
  v_seen_variant_skus text[] := '{}'::text[];
  v_seen_sizes text[] := '{}'::text[];
  v_stock integer;
  v_sizes text;
  v_size_stock jsonb;
  v_product_json jsonb;
  v_result jsonb;
begin
  if v_client_request_id = '' or pg_catalog.length(v_client_request_id) > 200 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: clientRequestId is required and must be at most 200 characters';
  end if;
  if p_product_id is null or p_product_id <= 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: productId is required';
  end if;
  if p_expected_metadata_version is null or p_expected_metadata_version < 1
     or p_expected_structure_version is null or p_expected_structure_version < 1 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: expected metadata and structure versions are required';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 300 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: actor is required and must be at most 300 characters';
  end if;
  if v_source = '' or pg_catalog.length(v_source) > 500 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: source is required and must be at most 500 characters';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: metadata must be an object';
  end if;
  if p_variants is not null
     and (pg_catalog.jsonb_typeof(p_variants) <> 'array' or pg_catalog.jsonb_array_length(p_variants) = 0) then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variants must be null for metadata-only edits or a non-empty authoritative array';
  end if;

  v_operation_key := 'product:update:' || v_client_request_id;
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'operation', 'update',
        'product_id', p_product_id,
        'expected_metadata_version', p_expected_metadata_version,
        'expected_structure_version', p_expected_structure_version,
        'metadata', p_metadata,
        'variants', p_variants,
        'actor', v_actor,
        'source', v_source
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_operation_key, 0));

  select * into v_existing
  from public.product_operations
  where operation_key = v_operation_key;

  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'PRODUCT_OPERATION_CONFLICT: clientRequestId was already used with a different product update payload';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product:id:' || p_product_id::text, 0)
  );

  select * into v_product
  from public.products
  where id = p_product_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_FOUND: product does not exist';
  end if;

  select id into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE' and active
  limit 1;
  if v_location_id is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_RUNTIME_UNAVAILABLE: MAIN_STORE inventory location is missing or inactive';
  end if;

  if p_variants is not null then
    perform app_private.product_lock_variant_identities(p_variants, p_product_id);

    -- POS locks balances before updating its product projection, while
    -- inventory_apply_rpc locks Variant/product before balance. A blocking lock
    -- order cannot be compatible with both historical writers. Structure edits
    -- therefore acquire their full lock set with NOWAIT and fail as an explicit
    -- stock conflict instead of participating in a cross-workflow deadlock.
    begin
      select * into v_product
      from public.products
      where id = p_product_id
      for update nowait;

      perform v.id
      from public.product_variants v
      where v.product_id = p_product_id
      order by v.id
      for update nowait;

      perform b.id
      from public.inventory_balances b
      join public.product_variants v on v.id = b.variant_id
      where v.product_id = p_product_id and b.location_id = v_location_id
      order by b.variant_id
      for update of b nowait;
    exception
      when lock_not_available then
        raise exception using errcode = 'P0001', message = 'PRODUCT_STOCK_CONFLICT: product inventory is being changed by POS or another inventory operation; retry after refreshing';
    end;
  else
    -- Metadata-only edits never touch balances or legacy stock projections, so
    -- waiting for the product row cannot form an inventory lock cycle.
    select * into v_product
    from public.products
    where id = p_product_id
    for update;
  end if;

  if v_product.metadata_version <> p_expected_metadata_version
     or v_product.structure_version <> p_expected_structure_version then
    raise exception using errcode = 'P0001', message = 'PRODUCT_VERSION_CONFLICT: product metadata or structure has changed; reload before retrying';
  end if;

  -- POS prefers product_variants.price over products.price. A base-price change
  -- must therefore carry the authoritative Variant list so inherited prices are
  -- updated in this same transaction while explicit Variant overrides survive.
  if p_metadata ? 'price'
     and (p_metadata ->> 'price')::numeric <> v_product.price
     and p_variants is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_VARIANTS_REQUIRED: changing product price requires the authoritative Variant list';
  end if;

  if p_metadata ? 'sku'
     and pg_catalog.btrim(coalesce(p_metadata ->> 'sku', '')) <> v_product.sku then
    raise exception using errcode = 'P0001', message = 'PRODUCT_SKU_IMMUTABLE: product sku cannot be changed after creation';
  end if;

  v_before := pg_catalog.to_jsonb(v_product);

  if p_variants is not null then
    for v_variant_item, v_ordinality in
      select item, ordinality
      from pg_catalog.jsonb_array_elements(p_variants) with ordinality as items(item, ordinality)
    loop
      if pg_catalog.jsonb_typeof(v_variant_item) <> 'object' then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: every variant must be an object';
      end if;
      if coalesce(nullif(v_variant_item ->> 'active', ''), 'true')::boolean = false then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: omit a zero-stock Variant to disable it; authoritative entries must be active';
      end if;

      v_variant_sku := pg_catalog.btrim(coalesce(v_variant_item ->> 'variant_sku', ''));
      v_barcode := nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'barcode', '')), '');
      v_size := pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v_variant_item ->> 'size', ''), 'ONE SIZE')));
      v_color := pg_catalog.btrim(coalesce(v_variant_item ->> 'color', p_metadata ->> 'color', v_product.color, ''));
      v_requested_id := nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'id', '')), '')::uuid;

      if v_variant_sku = '' or pg_catalog.length(v_variant_sku) > 250 then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: every variant requires a variant_sku of at most 250 characters';
      end if;
      if pg_catalog.lower(v_variant_sku) = any(v_seen_variant_skus) or v_size = any(v_seen_sizes) then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variant_sku and normalized size must be unique within a product catalog';
      end if;
      v_seen_variant_skus := pg_catalog.array_append(v_seen_variant_skus, pg_catalog.lower(v_variant_sku));
      v_seen_sizes := pg_catalog.array_append(v_seen_sizes, v_size);

      if coalesce(v_variant_item ->> 'quantity', '') !~ '^[0-9]+$' then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: variant quantity must be a non-negative integer';
      end if;
      v_quantity := (v_variant_item ->> 'quantity')::integer;
      v_sort_order := coalesce(nullif(v_variant_item ->> 'sort_order', '')::integer, (v_ordinality - 1)::integer);
      v_is_existing := false;

      if v_requested_id is not null then
        select * into v_variant
        from public.product_variants
        where id = v_requested_id;
        if not found or v_variant.product_id <> p_product_id then
          raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: Variant id does not belong to this product';
        end if;
        v_is_existing := true;
      else
        select * into v_variant
        from public.product_variants
        where pg_catalog.lower(pg_catalog.btrim(variant_sku)) = pg_catalog.lower(v_variant_sku);
        if found then
          if v_variant.product_id <> p_product_id then
            raise exception using errcode = 'P0001', message = 'PRODUCT_VARIANT_SKU_CONFLICT: variant_sku belongs to another product';
          end if;
          v_is_existing := true;
        else
          select * into v_variant
          from public.product_variants
          where product_id = p_product_id
            and pg_catalog.upper(pg_catalog.btrim(coalesce(size, 'ONE SIZE'))) = v_size
            and pg_catalog.lower(pg_catalog.btrim(coalesce(color, ''))) = pg_catalog.lower(v_color)
          limit 1;
          v_is_existing := found;
        end if;
      end if;

      if v_is_existing and v_variant.variant_sku <> v_variant_sku then
        raise exception using errcode = 'P0001', message = 'PRODUCT_VARIANT_SKU_IMMUTABLE: variant_sku cannot be changed after creation';
      end if;

      if not v_is_existing then
        insert into public.product_variants (
          product_id,
          variant_sku,
          barcode,
          size,
          color,
          cost_price,
          price,
          active,
          sort_order,
          supplier_id,
          supplier_sku,
          reorder_level
        ) values (
          p_product_id,
          v_variant_sku,
          v_barcode,
          v_size,
          v_color,
          nullif(v_variant_item ->> 'cost_price', '')::numeric,
          coalesce(nullif(v_variant_item ->> 'price', '')::numeric, v_product.price),
          true,
          v_sort_order,
          nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_id', '')), '')::uuid,
          nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_sku', '')), ''),
          nullif(v_variant_item ->> 'reorder_level', '')::integer
        )
        returning * into v_variant;

        insert into public.inventory_balances (
          variant_id,
          location_id,
          quantity_on_hand,
          quantity_reserved,
          updated_at
        ) values (
          v_variant.id,
          v_location_id,
          0,
          0,
          pg_catalog.now()
        )
        returning * into v_balance;
      else
        if not (v_variant_item ? 'expected_on_hand')
           or coalesce(v_variant_item ->> 'expected_on_hand', '') !~ '^[0-9]+$' then
          raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: existing variants require expected_on_hand';
        end if;
        v_expected_on_hand := (v_variant_item ->> 'expected_on_hand')::integer;

        select * into v_balance
        from public.inventory_balances
        where variant_id = v_variant.id and location_id = v_location_id
        for update;

        if not found then
          insert into public.inventory_balances (
            variant_id,
            location_id,
            quantity_on_hand,
            quantity_reserved,
            updated_at
          ) values (
            v_variant.id,
            v_location_id,
            0,
            0,
            pg_catalog.now()
          )
          returning * into v_balance;
        end if;

        if v_balance.quantity_on_hand <> v_expected_on_hand then
          raise exception using errcode = 'P0001', message = 'PRODUCT_STOCK_CONFLICT: Variant inventory changed; reload before retrying';
        end if;

        update public.product_variants
        set barcode = v_barcode,
            size = v_size,
            color = v_color,
            cost_price = nullif(v_variant_item ->> 'cost_price', '')::numeric,
            price = coalesce(nullif(v_variant_item ->> 'price', '')::numeric, v_product.price),
            active = true,
            sort_order = v_sort_order,
            supplier_id = nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_id', '')), '')::uuid,
            supplier_sku = nullif(pg_catalog.btrim(coalesce(v_variant_item ->> 'supplier_sku', '')), ''),
            reorder_level = nullif(v_variant_item ->> 'reorder_level', '')::integer,
            updated_at = pg_catalog.now()
        where id = v_variant.id
        returning * into v_variant;
      end if;

      if v_balance.quantity_reserved > v_quantity then
        raise exception using errcode = 'P0001', message = 'PRODUCT_STOCK_CONFLICT: target stock cannot be lower than reserved inventory';
      end if;

      if v_balance.quantity_on_hand <> v_quantity then
        update public.inventory_balances
        set quantity_on_hand = v_quantity,
            updated_at = pg_catalog.now()
        where id = v_balance.id;

        insert into public.stock_movements (
          variant_id,
          location_id,
          movement_type,
          quantity_delta,
          quantity_before,
          quantity_after,
          reason,
          source_type,
          source_id,
          idempotency_key,
          created_by
        ) values (
          v_variant.id,
          v_location_id,
          'manual_adjustment',
          v_quantity - v_balance.quantity_on_hand,
          v_balance.quantity_on_hand,
          v_quantity,
          v_source,
          'product_update',
          p_product_id::text,
          v_operation_key || ':variant:' || v_variant.id::text,
          v_actor
        );
      end if;

      v_included_ids := pg_catalog.array_append(v_included_ids, v_variant.id);
    end loop;

    for v_variant in
      select v.*
      from public.product_variants v
      where v.product_id = p_product_id
        and v.active
        and not (v.id = any(v_included_ids))
      order by v.id
    loop
      select * into v_balance
      from public.inventory_balances
      where variant_id = v_variant.id and location_id = v_location_id
      for update;

      if not found
         or v_balance.quantity_on_hand <> 0
         or v_balance.quantity_reserved <> 0 then
        raise exception using errcode = 'P0001', message = 'PRODUCT_VARIANT_DEACTIVATION_BLOCKED: every omitted Variant must have zero on-hand and reserved inventory';
      end if;

      update public.product_variants
      set active = false,
          updated_at = pg_catalog.now()
      where id = v_variant.id;
    end loop;

    select
      coalesce(pg_catalog.sum(b.quantity_on_hand), 0)::integer,
      coalesce(pg_catalog.string_agg(pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))), ',' order by v.sort_order, v.id), ''),
      coalesce(
        pg_catalog.jsonb_object_agg(
          pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))),
          b.quantity_on_hand
          order by v.sort_order, v.id
        ),
        '{}'::jsonb
      )
    into v_stock, v_sizes, v_size_stock
    from public.product_variants v
    join public.inventory_balances b
      on b.variant_id = v.id and b.location_id = v_location_id
    where v.product_id = p_product_id and v.active;
  else
    -- Metadata-only writes deliberately ignore any stale legacy stock fields in
    -- p_metadata. Inventory remains authoritative in inventory_balances.
    v_stock := v_product.stock;
    v_sizes := v_product.sizes;
    v_size_stock := v_product.size_stock;
  end if;

  update public.products
  set name_cn = case when p_metadata ? 'name_cn' then coalesce(p_metadata ->> 'name_cn', '') else v_product.name_cn end,
      name_gr = case when p_metadata ? 'name_gr' then coalesce(p_metadata ->> 'name_gr', '') else v_product.name_gr end,
      name_en = case when p_metadata ? 'name_en' then coalesce(p_metadata ->> 'name_en', '') else v_product.name_en end,
      description_cn = case when p_metadata ? 'description_cn' then coalesce(p_metadata ->> 'description_cn', '') else v_product.description_cn end,
      description_gr = case when p_metadata ? 'description_gr' then coalesce(p_metadata ->> 'description_gr', '') else v_product.description_gr end,
      description_en = case when p_metadata ? 'description_en' then coalesce(p_metadata ->> 'description_en', '') else v_product.description_en end,
      category = case when p_metadata ? 'category' then pg_catalog.btrim(coalesce(p_metadata ->> 'category', '')) else v_product.category end,
      subcategory = case when p_metadata ? 'subcategory' then coalesce(p_metadata ->> 'subcategory', '') else v_product.subcategory end,
      price = case when p_metadata ? 'price' then (p_metadata ->> 'price')::numeric else v_product.price end,
      stock = v_stock,
      sizes = v_sizes,
      size_stock = v_size_stock,
      image_url = case when p_metadata ? 'image_url' then coalesce(p_metadata ->> 'image_url', '') else v_product.image_url end,
      image_urls = case
        when p_metadata ? 'image_urls' and pg_catalog.jsonb_typeof(p_metadata -> 'image_urls') = 'array' then p_metadata -> 'image_urls'
        else v_product.image_urls
      end,
      image_width = case when p_metadata ? 'image_width' then nullif(p_metadata ->> 'image_width', '')::integer else v_product.image_width end,
      image_height = case when p_metadata ? 'image_height' then nullif(p_metadata ->> 'image_height', '')::integer else v_product.image_height end,
      brand = case when p_metadata ? 'brand' then coalesce(p_metadata ->> 'brand', '') else v_product.brand end,
      barcode = case when p_metadata ? 'barcode' then coalesce(p_metadata ->> 'barcode', '') else v_product.barcode end,
      ean = case when p_metadata ? 'ean' then coalesce(p_metadata ->> 'ean', '') else v_product.ean end,
      vat = case when p_metadata ? 'vat' then (p_metadata ->> 'vat')::numeric else v_product.vat end,
      color = case when p_metadata ? 'color' then coalesce(p_metadata ->> 'color', '') else v_product.color end,
      additional_image_urls = case when p_metadata ? 'additional_image_urls' then coalesce(p_metadata ->> 'additional_image_urls', '') else v_product.additional_image_urls end,
      skroutz_url = case when p_metadata ? 'skroutz_url' then coalesce(p_metadata ->> 'skroutz_url', '') else v_product.skroutz_url end,
      material = case when p_metadata ? 'material' then coalesce(p_metadata ->> 'material', '') else v_product.material end,
      fit = case when p_metadata ? 'fit' then coalesce(p_metadata ->> 'fit', '') else v_product.fit end,
      season = case when p_metadata ? 'season' then coalesce(p_metadata ->> 'season', '') else v_product.season end,
      mpn = case when p_metadata ? 'mpn' then coalesce(p_metadata ->> 'mpn', '') else v_product.mpn end,
      availability = case when p_metadata ? 'availability' then coalesce(p_metadata ->> 'availability', '') else v_product.availability end,
      size_chart = case
        when p_metadata ? 'size_chart' and pg_catalog.jsonb_typeof(p_metadata -> 'size_chart') = 'object' then p_metadata -> 'size_chart'
        else v_product.size_chart
      end,
      size_system = case when p_metadata ? 'size_system' then nullif(pg_catalog.btrim(coalesce(p_metadata ->> 'size_system', '')), '') else v_product.size_system end,
      fit_type = case when p_metadata ? 'fit_type' then coalesce(nullif(p_metadata ->> 'fit_type', ''), 'regular') else v_product.fit_type end,
      style_tags = case
        when p_metadata ? 'style_tags' and pg_catalog.jsonb_typeof(p_metadata -> 'style_tags') = 'array'
        then array(select pg_catalog.jsonb_array_elements_text(p_metadata -> 'style_tags'))
        else v_product.style_tags
      end,
      ai_keywords = case
        when p_metadata ? 'ai_keywords' and pg_catalog.jsonb_typeof(p_metadata -> 'ai_keywords') = 'array'
        then array(select pg_catalog.jsonb_array_elements_text(p_metadata -> 'ai_keywords'))
        else v_product.ai_keywords
      end,
      material_verified = case when p_metadata ? 'material_verified' then coalesce(nullif(p_metadata ->> 'material_verified', '')::boolean, false) else v_product.material_verified end,
      category_path_en = case when p_metadata ? 'category_path_en' then coalesce(p_metadata ->> 'category_path_en', '') else v_product.category_path_en end,
      category_path_gr = case when p_metadata ? 'category_path_gr' then coalesce(p_metadata ->> 'category_path_gr', '') else v_product.category_path_gr end,
      supplier_id = case when p_metadata ? 'supplier_id' then nullif(pg_catalog.btrim(coalesce(p_metadata ->> 'supplier_id', '')), '')::uuid else v_product.supplier_id end,
      supplier_style_code = case
        when p_metadata ? 'supplier_style_code' then coalesce(p_metadata ->> 'supplier_style_code', '')
        when p_metadata ? 'supplier_sku' then coalesce(p_metadata ->> 'supplier_sku', '')
        else v_product.supplier_style_code
      end,
      fiber_composition_gr = case when p_metadata ? 'fiber_composition_gr' then nullif(p_metadata ->> 'fiber_composition_gr', '') else v_product.fiber_composition_gr end,
      fiber_composition_en = case when p_metadata ? 'fiber_composition_en' then nullif(p_metadata ->> 'fiber_composition_en', '') else v_product.fiber_composition_en end,
      care_instructions_gr = case when p_metadata ? 'care_instructions_gr' then nullif(p_metadata ->> 'care_instructions_gr', '') else v_product.care_instructions_gr end,
      care_instructions_en = case when p_metadata ? 'care_instructions_en' then nullif(p_metadata ->> 'care_instructions_en', '') else v_product.care_instructions_en end,
      country_of_origin = case when p_metadata ? 'country_of_origin' then nullif(p_metadata ->> 'country_of_origin', '') else v_product.country_of_origin end,
      manufacturer_name = case when p_metadata ? 'manufacturer_name' then nullif(p_metadata ->> 'manufacturer_name', '') else v_product.manufacturer_name end,
      manufacturer_contact = case when p_metadata ? 'manufacturer_contact' then nullif(p_metadata ->> 'manufacturer_contact', '') else v_product.manufacturer_contact end,
      eu_responsible_person = case when p_metadata ? 'eu_responsible_person' then nullif(p_metadata ->> 'eu_responsible_person', '') else v_product.eu_responsible_person end,
      product_safety_notes_gr = case when p_metadata ? 'product_safety_notes_gr' then nullif(p_metadata ->> 'product_safety_notes_gr', '') else v_product.product_safety_notes_gr end,
      product_safety_notes_en = case when p_metadata ? 'product_safety_notes_en' then nullif(p_metadata ->> 'product_safety_notes_en', '') else v_product.product_safety_notes_en end,
      is_active = case when p_metadata ? 'is_active' then coalesce(nullif(p_metadata ->> 'is_active', '')::boolean, true) else v_product.is_active end,
      metadata_version = v_product.metadata_version + 1,
      structure_version = v_product.structure_version + case when p_variants is null then 0 else 1 end
  where id = p_product_id;

  select pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'variants',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object(
            'quantity_on_hand', coalesce(b.quantity_on_hand, 0),
            'quantity_reserved', coalesce(b.quantity_reserved, 0)
          )
          order by v.sort_order, v.id
        )
        from public.product_variants v
        left join public.inventory_balances b
          on b.variant_id = v.id and b.location_id = v_location_id
        where v.product_id = p.id
      ),
      '[]'::jsonb
    )
  )
  into v_product_json
  from public.products p
  where p.id = p_product_id;

  v_result := pg_catalog.jsonb_build_object('product', v_product_json, 'replayed', false);

  insert into public.audit_logs (
    actor,
    action,
    entity,
    entity_id,
    before,
    after,
    metadata
  ) values (
    v_actor,
    'product_update',
    'product',
    p_product_id::text,
    v_before,
    v_product_json,
    pg_catalog.jsonb_build_object(
      'operation_key', v_operation_key,
      'source', v_source,
      'structure_changed', p_variants is not null,
      'expected_metadata_version', p_expected_metadata_version,
      'expected_structure_version', p_expected_structure_version
    )
  );

  insert into public.product_operations (
    operation_key,
    client_request_id,
    operation_type,
    product_id,
    payload_fingerprint,
    actor,
    source,
    result
  ) values (
    v_operation_key,
    v_client_request_id,
    'update',
    p_product_id,
    v_fingerprint,
    v_actor,
    v_source,
    v_result
  );

  return v_result;
end;
$$;

create or replace function public.product_bulk_status_rpc(
  p_client_request_id text,
  p_items jsonb,
  p_actor text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_operation_key text;
  v_fingerprint text;
  v_existing public.product_operations%rowtype;
  v_item jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_seen_product_ids bigint[] := '{}'::bigint[];
  v_product_id bigint;
  v_expected_metadata_version bigint;
  v_expected_structure_version bigint;
  v_is_active boolean;
  v_expected_count integer;
  v_found_count integer;
  v_parent_hash text;
  v_child_request_id text;
  v_child_result jsonb;
  v_products jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_client_request_id = '' or pg_catalog.length(v_client_request_id) > 200 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: clientRequestId is required and must be at most 200 characters';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 300 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: actor is required and must be at most 300 characters';
  end if;
  if v_source = '' or pg_catalog.length(v_source) > 500 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: source is required and must be at most 500 characters';
  end if;
  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: bulk status items must be a non-empty array';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 500 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: bulk status is limited to 500 products';
  end if;

  for v_item in
    select item
    from pg_catalog.jsonb_array_elements(p_items) as items(item)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: every bulk status item must be an object';
    end if;
    if coalesce(v_item ->> 'product_id', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item ->> 'expected_metadata_version', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item ->> 'expected_structure_version', '') !~ '^[1-9][0-9]*$'
       or pg_catalog.jsonb_typeof(v_item -> 'is_active') <> 'boolean' then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: bulk items require product_id, expected metadata/structure versions, and boolean is_active';
    end if;

    begin
      v_product_id := (v_item ->> 'product_id')::bigint;
      v_expected_metadata_version := (v_item ->> 'expected_metadata_version')::bigint;
      v_expected_structure_version := (v_item ->> 'expected_structure_version')::bigint;
    exception
      when numeric_value_out_of_range then
        raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: bulk item numeric value is out of range';
    end;
    v_is_active := (v_item ->> 'is_active')::boolean;

    if v_product_id = any(v_seen_product_ids) then
      raise exception using errcode = 'P0001', message = 'PRODUCT_INVALID_ARGUMENT: a product may appear only once in a bulk status operation';
    end if;
    v_seen_product_ids := pg_catalog.array_append(v_seen_product_ids, v_product_id);

    v_normalized_items := v_normalized_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', v_product_id,
        'expected_metadata_version', v_expected_metadata_version,
        'expected_structure_version', v_expected_structure_version,
        'is_active', v_is_active
      )
    );
  end loop;

  -- Array order is not business data. Canonicalize by product ID so reordered
  -- retries have the same fingerprint and every caller acquires row locks in
  -- the same deterministic order.
  select pg_catalog.jsonb_agg(item order by (item ->> 'product_id')::bigint)
  into v_normalized_items
  from pg_catalog.jsonb_array_elements(v_normalized_items) as items(item);

  v_operation_key := 'product:bulk_status:' || v_client_request_id;
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'operation', 'bulk_status',
        'items', v_normalized_items,
        'actor', v_actor,
        'source', v_source
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_operation_key, 0));

  select * into v_existing
  from public.product_operations
  where operation_key = v_operation_key;

  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'PRODUCT_OPERATION_CONFLICT: clientRequestId was already used with different bulk status items';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  -- Match the single-product RPC lock order before taking any product row.
  -- Without these advisory locks, a normal update could hold product:id while
  -- waiting for a row already locked by this batch, while the batch child then
  -- waited for that same advisory lock. Ordering every product ID prevents
  -- both normal-vs-bulk and bulk-vs-bulk deadlocks.
  for v_item in
    select item
    from pg_catalog.jsonb_array_elements(v_normalized_items) as items(item)
    order by (item ->> 'product_id')::bigint
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('product:id:' || (v_item ->> 'product_id'), 0)
    );
  end loop;

  -- Lock the complete batch before applying the first child. ORDER BY remains
  -- part of the concurrency contract for the physical product rows.
  perform p.id
  from public.products p
  join pg_catalog.jsonb_array_elements(v_normalized_items) as items(item)
    on p.id = (item ->> 'product_id')::bigint
  order by p.id
  for update of p;

  v_expected_count := pg_catalog.jsonb_array_length(v_normalized_items);
  select pg_catalog.count(*)::integer into v_found_count
  from public.products p
  join pg_catalog.jsonb_array_elements(v_normalized_items) as items(item)
    on p.id = (item ->> 'product_id')::bigint;

  if v_found_count <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_FOUND: one or more bulk status products do not exist';
  end if;

  v_parent_hash := pg_catalog.encode(
    extensions.digest(v_client_request_id, 'sha256'),
    'hex'
  );

  for v_item in
    select item
    from pg_catalog.jsonb_array_elements(v_normalized_items) as items(item)
    order by (item ->> 'product_id')::bigint
  loop
    v_product_id := (v_item ->> 'product_id')::bigint;
    v_expected_metadata_version := (v_item ->> 'expected_metadata_version')::bigint;
    v_expected_structure_version := (v_item ->> 'expected_structure_version')::bigint;
    v_is_active := (v_item ->> 'is_active')::boolean;
    v_child_request_id := 'bulk-status:' || pg_catalog.substr(v_parent_hash, 1, 40) || ':' || v_product_id::text;

    select public.product_update_rpc(
      v_child_request_id,
      v_product_id,
      v_expected_metadata_version,
      v_expected_structure_version,
      pg_catalog.jsonb_build_object('is_active', v_is_active),
      null,
      v_actor,
      v_source
    ) into v_child_result;

    v_products := v_products || pg_catalog.jsonb_build_array(v_child_result -> 'product');
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'products', v_products,
    'items', v_normalized_items,
    'updated_count', v_expected_count,
    'replayed', false
  );

  insert into public.audit_logs (
    actor,
    action,
    entity,
    entity_id,
    before,
    after,
    metadata
  ) values (
    v_actor,
    'product_bulk_status',
    'product_batch',
    v_client_request_id,
    null,
    v_result,
    pg_catalog.jsonb_build_object(
      'operation_key', v_operation_key,
      'source', v_source,
      'product_count', v_expected_count
    )
  );

  -- Parent operation is deliberately last. A parent record fault or any child
  -- failure rolls the entire batch, every child operation, and every audit row
  -- back in the same PostgreSQL transaction.
  insert into public.product_operations (
    operation_key,
    client_request_id,
    operation_type,
    product_id,
    payload_fingerprint,
    actor,
    source,
    result
  ) values (
    v_operation_key,
    v_client_request_id,
    'bulk_status',
    null,
    v_fingerprint,
    v_actor,
    v_source,
    v_result
  );

  return v_result;
end;
$$;

revoke execute on function public.product_update_rpc(text, bigint, bigint, bigint, jsonb, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.product_update_rpc(text, bigint, bigint, bigint, jsonb, jsonb, text, text)
to service_role;

revoke execute on function public.product_bulk_status_rpc(text, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.product_bulk_status_rpc(text, jsonb, text, text)
to service_role;

commit;
