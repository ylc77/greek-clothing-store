begin;

create table if not exists public.product_import_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  client_request_id text not null unique,
  payload_hash text not null,
  filename text not null,
  import_mode text not null,
  inventory_mode text not null,
  status text not null default 'pending',
  total_rows integer not null,
  pending_rows integer not null,
  succeeded_rows integer not null default 0,
  failed_rows integer not null default 0,
  actor text not null,
  source text not null,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_import_jobs_request_id_check
    check (pg_catalog.btrim(client_request_id) <> '' and pg_catalog.length(client_request_id) <= 200),
  constraint product_import_jobs_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint product_import_jobs_filename_check
    check (pg_catalog.btrim(filename) <> '' and pg_catalog.length(filename) <= 255),
  constraint product_import_jobs_import_mode_check
    check (import_mode in ('create_only', 'update_existing', 'upsert')),
  constraint product_import_jobs_inventory_mode_check
    check (inventory_mode in ('metadata_only', 'set_inventory')),
  constraint product_import_jobs_status_check
    check (status in ('pending', 'running', 'completed', 'partial', 'failed')),
  constraint product_import_jobs_counts_check
    check (
      total_rows between 1 and 500
      and pending_rows >= 0
      and succeeded_rows >= 0
      and failed_rows >= 0
    ),
  constraint product_import_jobs_actor_check
    check (pg_catalog.btrim(actor) <> '' and pg_catalog.length(actor) <= 300),
  constraint product_import_jobs_source_check
    check (pg_catalog.btrim(source) <> '' and pg_catalog.length(source) <= 500),
  constraint product_import_jobs_summary_check
    check (pg_catalog.jsonb_typeof(result_summary) = 'object')
);

create table if not exists public.product_import_rows (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.product_import_jobs(id) on delete cascade,
  row_number integer not null,
  normalized_sku text not null,
  row_hash text not null,
  operation_id text not null unique,
  metadata jsonb not null,
  variants jsonb not null,
  resolved_action text,
  expected_product_id bigint references public.products(id) on delete set null,
  expected_metadata_version bigint,
  expected_structure_version bigint,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  retryable boolean not null default false,
  product_id bigint references public.products(id) on delete set null,
  error_code text,
  error_summary text,
  result_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint product_import_rows_job_row_unique unique (job_id, row_number),
  constraint product_import_rows_job_sku_unique unique (job_id, normalized_sku),
  constraint product_import_rows_row_number_check check (row_number > 0),
  constraint product_import_rows_normalized_sku_check check (
    normalized_sku = pg_catalog.lower(pg_catalog.btrim(normalized_sku))
    and normalized_sku <> ''
    and pg_catalog.length(normalized_sku) <= 200
  ),
  constraint product_import_rows_hash_check check (row_hash ~ '^[0-9a-f]{64}$'),
  constraint product_import_rows_operation_id_check check (
    pg_catalog.btrim(operation_id) <> '' and pg_catalog.length(operation_id) <= 200
  ),
  constraint product_import_rows_metadata_check check (pg_catalog.jsonb_typeof(metadata) = 'object'),
  constraint product_import_rows_variants_check check (pg_catalog.jsonb_typeof(variants) = 'array'),
  constraint product_import_rows_action_check check (resolved_action is null or resolved_action in ('create', 'update')),
  constraint product_import_rows_versions_check check (
    (expected_metadata_version is null or expected_metadata_version > 0)
    and (expected_structure_version is null or expected_structure_version > 0)
  ),
  constraint product_import_rows_status_check check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint product_import_rows_attempt_check check (attempt_count >= 0),
  constraint product_import_rows_error_code_check check (error_code is null or pg_catalog.length(error_code) <= 100),
  constraint product_import_rows_error_summary_check check (error_summary is null or pg_catalog.length(error_summary) <= 500),
  constraint product_import_rows_result_check check (pg_catalog.jsonb_typeof(result_snapshot) = 'object')
);

create index if not exists product_import_jobs_status_idx
  on public.product_import_jobs(status, created_at desc);
create index if not exists product_import_rows_job_status_idx
  on public.product_import_rows(job_id, status, row_number);
create index if not exists product_import_rows_sku_idx
  on public.product_import_rows(normalized_sku);

alter table public.product_import_jobs enable row level security;
alter table public.product_import_rows enable row level security;
revoke all on table public.product_import_jobs from public, anon, authenticated;
revoke all on table public.product_import_rows from public, anon, authenticated;
grant select, insert, update, delete on table public.product_import_jobs to service_role;
grant select, insert, update, delete on table public.product_import_rows to service_role;

create or replace function app_private.product_import_authoritative_variants(
  p_product_id bigint,
  p_imported_variants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_result jsonb;
begin
  if p_product_id is null or p_product_id <= 0
     or p_imported_variants is null
     or pg_catalog.jsonb_typeof(p_imported_variants) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: invalid authoritative Variant merge input';
  end if;

  select id into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE' and active
  limit 1;
  if v_location_id is null then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_RUNTIME_UNAVAILABLE: MAIN_STORE is missing or inactive';
  end if;

  with existing as (
    select
      v.*,
      coalesce(b.quantity_on_hand, 0) as quantity_on_hand,
      coalesce(b.quantity_reserved, 0) as quantity_reserved
    from public.product_variants v
    left join public.inventory_balances b
      on b.variant_id = v.id and b.location_id = v_location_id
    where v.product_id = p_product_id and v.active
  ),
  imported as (
    select item, ordinality
    from pg_catalog.jsonb_array_elements(p_imported_variants) with ordinality as entries(item, ordinality)
  ),
  merged_existing as (
    select
      e.id,
      coalesce(match.item ->> 'variant_sku', e.variant_sku) as variant_sku,
      case when match.item ? 'barcode' then nullif(match.item ->> 'barcode', '') else e.barcode end as barcode,
      pg_catalog.upper(pg_catalog.btrim(coalesce(match.item ->> 'size', e.size, 'ONE SIZE'))) as size,
      coalesce(match.item ->> 'color', e.color, '') as color,
      coalesce(nullif(match.item ->> 'quantity', '')::integer, e.quantity_on_hand) as quantity,
      coalesce(nullif(match.item ->> 'expected_on_hand', '')::integer, e.quantity_on_hand) as expected_on_hand,
      case when match.item ? 'price' then nullif(match.item ->> 'price', '')::numeric else e.price end as price,
      case when match.item ? 'cost_price' then nullif(match.item ->> 'cost_price', '')::numeric else e.cost_price end as cost_price,
      case when match.item ? 'supplier_id' then nullif(match.item ->> 'supplier_id', '')::uuid else e.supplier_id end as supplier_id,
      case when match.item ? 'supplier_sku' then nullif(match.item ->> 'supplier_sku', '') else e.supplier_sku end as supplier_sku,
      case when match.item ? 'reorder_level' then nullif(match.item ->> 'reorder_level', '')::integer else e.reorder_level end as reorder_level,
      coalesce(nullif(match.item ->> 'sort_order', '')::integer, e.sort_order) as sort_order,
      match.ordinality as imported_ordinality
    from existing e
    left join lateral (
      select i.item, i.ordinality
      from imported i
      where (
        nullif(pg_catalog.btrim(coalesce(i.item ->> 'id', '')), '')::uuid = e.id
        or pg_catalog.lower(pg_catalog.btrim(coalesce(i.item ->> 'variant_sku', ''))) = pg_catalog.lower(pg_catalog.btrim(e.variant_sku))
        or (
          pg_catalog.upper(pg_catalog.btrim(coalesce(i.item ->> 'size', 'ONE SIZE')))
            = pg_catalog.upper(pg_catalog.btrim(coalesce(e.size, 'ONE SIZE')))
          and pg_catalog.lower(pg_catalog.btrim(coalesce(i.item ->> 'color', e.color, '')))
            = pg_catalog.lower(pg_catalog.btrim(coalesce(e.color, '')))
        )
      )
      order by i.ordinality
      limit 1
    ) match on true
  ),
  new_imported as (
    select i.item, i.ordinality
    from imported i
    where not exists (
      select 1
      from existing e
      where (
        nullif(pg_catalog.btrim(coalesce(i.item ->> 'id', '')), '')::uuid = e.id
        or pg_catalog.lower(pg_catalog.btrim(coalesce(i.item ->> 'variant_sku', ''))) = pg_catalog.lower(pg_catalog.btrim(e.variant_sku))
        or (
          pg_catalog.upper(pg_catalog.btrim(coalesce(i.item ->> 'size', 'ONE SIZE')))
            = pg_catalog.upper(pg_catalog.btrim(coalesce(e.size, 'ONE SIZE')))
          and pg_catalog.lower(pg_catalog.btrim(coalesce(i.item ->> 'color', e.color, '')))
            = pg_catalog.lower(pg_catalog.btrim(coalesce(e.color, '')))
        )
      )
    )
  ),
  all_rows as (
    select
      pg_catalog.jsonb_build_object(
        'id', m.id,
        'variant_sku', m.variant_sku,
        'barcode', m.barcode,
        'size', m.size,
        'color', m.color,
        'quantity', m.quantity,
        'expected_on_hand', m.expected_on_hand,
        'price', m.price,
        'cost_price', m.cost_price,
        'supplier_id', m.supplier_id,
        'supplier_sku', m.supplier_sku,
        'reorder_level', m.reorder_level,
        'active', true,
        'sort_order', m.sort_order
      ) as item,
      m.sort_order::bigint as ordering,
      m.id::text as tie_breaker
    from merged_existing m
    union all
    select
      n.item || pg_catalog.jsonb_build_object('active', true),
      (1000000 + n.ordinality)::bigint,
      n.ordinality::text
    from new_imported n
  )
  select coalesce(pg_catalog.jsonb_agg(item order by ordering, tie_breaker), '[]'::jsonb)
  into v_result
  from all_rows;

  return v_result;
end;
$$;

revoke all on function app_private.product_import_authoritative_variants(bigint, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.product_import_preview_rpc(p_normalized_skus jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skus text[];
  v_result jsonb;
begin
  if p_normalized_skus is null
     or pg_catalog.jsonb_typeof(p_normalized_skus) <> 'array'
     or pg_catalog.jsonb_array_length(p_normalized_skus) > 500 then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: normalized SKU list must be a bounded array';
  end if;
  select coalesce(pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(value))), '{}'::text[])
  into v_skus
  from pg_catalog.jsonb_array_elements_text(p_normalized_skus) as entries(value)
  where pg_catalog.btrim(value) <> '';

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
      'variants', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object(
            'quantity_on_hand', coalesce(b.quantity_on_hand, 0),
            'quantity_reserved', coalesce(b.quantity_reserved, 0)
          ) order by v.sort_order, v.id
        )
        from public.product_variants v
        left join public.inventory_locations l on l.code = 'MAIN_STORE'
        left join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
        where v.product_id = p.id and v.active
      ), '[]'::jsonb)
    ) order by p.id
  ), '[]'::jsonb)
  into v_result
  from public.products p
  where pg_catalog.lower(pg_catalog.btrim(p.sku)) = any(v_skus);

  return v_result;
end;
$$;

create or replace function public.product_import_start_rpc(
  p_client_request_id text,
  p_payload_hash text,
  p_filename text,
  p_import_mode text,
  p_inventory_mode text,
  p_rows jsonb,
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
  v_payload_hash text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload_hash, '')));
  v_filename text := pg_catalog.btrim(coalesce(p_filename, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_existing public.product_import_jobs%rowtype;
  v_job public.product_import_jobs%rowtype;
  v_item jsonb;
  v_row_number integer;
  v_metadata jsonb;
  v_variants jsonb;
  v_normalized_sku text;
  v_row_hash text;
  v_operation_id text;
  v_action text;
  v_expected_product_id bigint;
  v_expected_metadata_version bigint;
  v_expected_structure_version bigint;
begin
  if v_client_request_id = '' or pg_catalog.length(v_client_request_id) > 200
     or v_payload_hash !~ '^[0-9a-f]{64}$'
     or v_filename = '' or pg_catalog.length(v_filename) > 255
     or p_import_mode not in ('create_only', 'update_existing', 'upsert')
     or p_inventory_mode not in ('metadata_only', 'set_inventory')
     or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) < 1 or pg_catalog.jsonb_array_length(p_rows) > 500
     or v_actor = '' or pg_catalog.length(v_actor) > 300
     or v_source = '' or pg_catalog.length(v_source) > 500 then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: invalid import job parameters';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('csv-import-job:' || v_client_request_id, 0)
  );

  select * into v_existing
  from public.product_import_jobs
  where client_request_id = v_client_request_id;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_OPERATION_CONFLICT: PAYLOAD for this import operation ID is different';
    end if;
    return pg_catalog.jsonb_build_object(
      'job', pg_catalog.to_jsonb(v_existing),
      'replayed', true
    );
  end if;

  insert into public.product_import_jobs (
    client_request_id, payload_hash, filename, import_mode, inventory_mode,
    total_rows, pending_rows, actor, source
  ) values (
    v_client_request_id, v_payload_hash, v_filename, p_import_mode, p_inventory_mode,
    pg_catalog.jsonb_array_length(p_rows), pg_catalog.jsonb_array_length(p_rows), v_actor, v_source
  ) returning * into v_job;

  for v_item in select item from pg_catalog.jsonb_array_elements(p_rows) as entries(item)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: every row must be an object';
    end if;
    v_row_number := nullif(v_item ->> 'row_number', '')::integer;
    v_metadata := v_item -> 'metadata';
    v_variants := coalesce(v_item -> 'variants', '[]'::jsonb);
    v_normalized_sku := pg_catalog.lower(pg_catalog.btrim(coalesce(v_metadata ->> 'sku', v_item ->> 'normalized_sku', '')));
    v_row_hash := pg_catalog.lower(pg_catalog.btrim(coalesce(v_item ->> 'row_hash', '')));
    v_action := nullif(pg_catalog.btrim(coalesce(v_item ->> 'resolved_action', '')), '');
    v_expected_product_id := nullif(v_item ->> 'expected_product_id', '')::bigint;
    v_expected_metadata_version := nullif(v_item ->> 'expected_metadata_version', '')::bigint;
    v_expected_structure_version := nullif(v_item ->> 'expected_structure_version', '')::bigint;
    v_operation_id := 'csv:' || v_job.id::text || ':row:' || v_row_number::text;

    if v_row_number is null or v_row_number <= 0
       or v_normalized_sku = '' or pg_catalog.length(v_normalized_sku) > 200
       or v_row_hash !~ '^[0-9a-f]{64}$'
       or v_metadata is null or pg_catalog.jsonb_typeof(v_metadata) <> 'object'
       or pg_catalog.jsonb_typeof(v_variants) <> 'array'
       or (v_action is not null and v_action not in ('create', 'update')) then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: invalid import row';
    end if;

    insert into public.product_import_rows (
      job_id, row_number, normalized_sku, row_hash, operation_id,
      metadata, variants, resolved_action, expected_product_id,
      expected_metadata_version, expected_structure_version
    ) values (
      v_job.id, v_row_number, v_normalized_sku, v_row_hash, v_operation_id,
      v_metadata, v_variants, v_action, v_expected_product_id,
      v_expected_metadata_version, v_expected_structure_version
    );
  end loop;

  select * into v_job from public.product_import_jobs where id = v_job.id;
  return pg_catalog.jsonb_build_object('job', pg_catalog.to_jsonb(v_job), 'replayed', false);
end;
$$;

create or replace function public.product_import_apply_row_rpc(
  p_job_id uuid,
  p_row_number integer,
  p_actor text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.product_import_jobs%rowtype;
  v_row public.product_import_rows%rowtype;
  v_product public.products%rowtype;
  v_action text;
  v_metadata jsonb;
  v_variants jsonb;
  v_result jsonb;
  v_product_id bigint;
  v_error text;
  v_error_code text;
  v_error_summary text;
  v_retryable boolean;
  v_expected_metadata_version bigint;
  v_expected_structure_version bigint;
begin
  if p_job_id is null or p_row_number is null or p_row_number <= 0
     or pg_catalog.btrim(coalesce(p_actor, '')) = ''
     or pg_catalog.btrim(coalesce(p_source, '')) = '' then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: invalid row apply parameters';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('csv-import-row:' || p_job_id::text || ':' || p_row_number::text, 0)
  );

  select * into v_job
  from public.product_import_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_JOB_NOT_FOUND: import job does not exist';
  end if;

  select * into v_row
  from public.product_import_rows
  where job_id = p_job_id and row_number = p_row_number
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ROW_NOT_FOUND: import row does not exist';
  end if;

  if v_row.status = 'succeeded' then
    return pg_catalog.jsonb_build_object('row', pg_catalog.to_jsonb(v_row), 'replayed', true);
  end if;
  if v_row.status = 'failed' and not v_row.retryable then
    return pg_catalog.jsonb_build_object('row', pg_catalog.to_jsonb(v_row), 'replayed', true);
  end if;

  update public.product_import_rows
  set status = 'processing',
      attempt_count = attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      updated_at = pg_catalog.now(),
      retryable = false,
      error_code = null,
      error_summary = null
  where id = v_row.id
  returning * into v_row;

  update public.product_import_jobs
  set status = 'running',
      started_at = coalesce(started_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where id = v_job.id;

  begin
    select * into v_product
    from public.products
    where pg_catalog.lower(pg_catalog.btrim(sku)) = v_row.normalized_sku
    limit 1;

    v_action := v_row.resolved_action;
    if v_action is null then
      v_action := case when found then 'update' else 'create' end;
    end if;

    if v_job.import_mode = 'create_only' and found then
      raise exception using errcode = 'P0001', message = 'CSV_PRODUCT_EXISTS: SKU already exists';
    end if;
    if v_job.import_mode = 'update_existing' and not found then
      raise exception using errcode = 'P0001', message = 'CSV_PRODUCT_NOT_FOUND: SKU does not exist';
    end if;
    if v_action = 'create' and found then
      raise exception using errcode = 'P0001', message = 'CSV_PRODUCT_EXISTS: frozen create action now conflicts with an existing SKU';
    end if;
    if v_action = 'update' and not found then
      raise exception using errcode = 'P0001', message = 'CSV_PRODUCT_NOT_FOUND: frozen update target no longer exists';
    end if;
    if v_action = 'update' and v_row.expected_product_id is not null and v_product.id <> v_row.expected_product_id then
      raise exception using errcode = 'P0001', message = 'CSV_PRODUCT_CONFLICT: SKU now identifies a different product';
    end if;

    v_metadata := v_row.metadata - 'stock' - 'sizes' - 'size_stock';
    if v_action = 'create' then
      if v_job.inventory_mode = 'metadata_only' then
        if pg_catalog.jsonb_array_length(v_row.variants) = 0 then
          v_variants := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'variant_sku', coalesce(v_row.metadata ->> 'sku', v_row.normalized_sku) || '-ONE-SIZE',
            'barcode', null,
            'size', 'ONE SIZE',
            'color', coalesce(v_row.metadata ->> 'color', ''),
            'quantity', 0,
            'price', v_row.metadata -> 'price',
            'active', true,
            'sort_order', 0
          ));
        else
          select pg_catalog.jsonb_agg((item - 'expected_on_hand') || pg_catalog.jsonb_build_object('quantity', 0) order by ordinality)
          into v_variants
          from pg_catalog.jsonb_array_elements(v_row.variants) with ordinality as entries(item, ordinality);
        end if;
      else
        v_variants := v_row.variants;
        if pg_catalog.jsonb_array_length(v_variants) = 0 then
          raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: set_inventory create requires at least one Variant';
        end if;
      end if;

      v_result := public.product_create_rpc(
        v_row.operation_id,
        v_metadata,
        v_variants,
        v_job.actor,
        'csv_import:' || v_job.source
      );
    else
      v_expected_metadata_version := coalesce(v_row.expected_metadata_version, v_product.metadata_version);
      v_expected_structure_version := coalesce(v_row.expected_structure_version, v_product.structure_version);
      if v_job.inventory_mode = 'metadata_only' then
        v_variants := null;
      else
        v_variants := app_private.product_import_authoritative_variants(v_product.id, v_row.variants);
      end if;
      v_result := public.product_update_rpc(
        v_row.operation_id,
        v_product.id,
        v_expected_metadata_version,
        v_expected_structure_version,
        v_metadata,
        v_variants,
        v_job.actor,
        'csv_import:' || v_job.source
      );
    end if;

    v_product_id := nullif(v_result -> 'product' ->> 'id', '')::bigint;
    if v_product_id is null then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_RESULT_UNKNOWN: product transaction returned no product ID';
    end if;

    update public.product_import_rows
    set status = 'succeeded',
        retryable = false,
        resolved_action = v_action,
        product_id = v_product_id,
        error_code = null,
        error_summary = null,
        result_snapshot = pg_catalog.jsonb_build_object(
          'product_id', v_product_id,
          'operation_id', operation_id,
          'action', v_action
        ),
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = v_row.id
    returning * into v_row;
  exception
    when others then
      get stacked diagnostics v_error = message_text;
      v_retryable := false;
      if v_error like '%CSV_PRODUCT_EXISTS%' or v_error like '%PRODUCT_SKU_CONFLICT%' then
        v_error_code := 'CSV_PRODUCT_EXISTS';
        v_error_summary := 'SKU already exists; the row was not written.';
      elsif v_error like '%CSV_PRODUCT_NOT_FOUND%' or v_error like '%PRODUCT_NOT_FOUND%' then
        v_error_code := 'CSV_PRODUCT_NOT_FOUND';
        v_error_summary := 'SKU does not exist; the row was not written.';
      elsif v_error like '%reserved%' or v_error like '%RESERV%' then
        v_error_code := 'CSV_INVENTORY_RESERVED_CONFLICT';
        v_error_summary := 'Target inventory is below reserved inventory; the row was rolled back.';
      elsif v_error like '%PRODUCT_VERSION_CONFLICT%' then
        v_error_code := 'CSV_PRODUCT_VERSION_CONFLICT';
        v_error_summary := 'Product changed after preview; create a new preview before retrying.';
      elsif v_error like '%PRODUCT_STOCK_CONFLICT%' then
        v_error_code := 'CSV_PRODUCT_STOCK_CONFLICT';
        v_error_summary := 'Inventory changed after preview; create a new preview before retrying.';
      elsif v_error like '%PRODUCT_VARIANT_%' or v_error like '%PRODUCT_INVALID_ARGUMENT%' then
        v_error_code := 'CSV_PRODUCT_CONFLICT';
        v_error_summary := 'Product or Variant data conflicts with the current catalog; the row was rolled back.';
      elsif v_error like '%CSV_IMPORT_INVALID_ARGUMENT%' then
        v_error_code := 'CSV_IMPORT_INVALID_ARGUMENT';
        v_error_summary := 'The normalized import row is invalid; the row was not written.';
      else
        v_error_code := 'CSV_ROW_RETRYABLE_FAILURE';
        v_error_summary := 'Temporary transactional row failure; the complete row was rolled back and is safe to retry.';
        v_retryable := true;
      end if;

      update public.product_import_rows
      set status = 'failed',
          retryable = v_retryable,
          error_code = v_error_code,
          error_summary = v_error_summary,
          result_snapshot = '{}'::jsonb,
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
      where id = v_row.id
      returning * into v_row;
  end;

  return pg_catalog.jsonb_build_object('row', pg_catalog.to_jsonb(v_row), 'replayed', false);
end;
$$;

create or replace function public.product_import_refresh_job_rpc(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.product_import_jobs%rowtype;
  v_pending integer;
  v_succeeded integer;
  v_failed integer;
  v_status text;
begin
  if p_job_id is null then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INVALID_ARGUMENT: job id is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csv-import-summary:' || p_job_id::text, 0));
  select * into v_job from public.product_import_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_JOB_NOT_FOUND: import job does not exist';
  end if;

  select
    pg_catalog.count(*) filter (where status in ('pending', 'processing'))::integer,
    pg_catalog.count(*) filter (where status = 'succeeded')::integer,
    pg_catalog.count(*) filter (where status = 'failed')::integer
  into v_pending, v_succeeded, v_failed
  from public.product_import_rows
  where job_id = p_job_id;

  v_status := case
    when v_pending > 0 and v_succeeded + v_failed = 0 then 'pending'
    when v_pending > 0 then 'running'
    when v_failed = 0 then 'completed'
    when v_succeeded = 0 then 'failed'
    else 'partial'
  end;

  update public.product_import_jobs
  set pending_rows = v_pending,
      succeeded_rows = v_succeeded,
      failed_rows = v_failed,
      status = v_status,
      started_at = case when v_succeeded + v_failed > 0 then coalesce(started_at, pg_catalog.now()) else started_at end,
      completed_at = case when v_pending = 0 then coalesce(completed_at, pg_catalog.now()) else null end,
      result_summary = pg_catalog.jsonb_build_object(
        'total', total_rows,
        'pending', v_pending,
        'succeeded', v_succeeded,
        'failed', v_failed
      ),
      updated_at = pg_catalog.now()
  where id = p_job_id
  returning * into v_job;

  return pg_catalog.jsonb_build_object('job', pg_catalog.to_jsonb(v_job));
end;
$$;

create or replace function public.product_import_reconciliation_rpc(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary_mismatches jsonb;
  v_succeeded_missing_result jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'job_id', j.id,
    'stored', pg_catalog.jsonb_build_object(
      'total', j.total_rows,
      'pending', j.pending_rows,
      'succeeded', j.succeeded_rows,
      'failed', j.failed_rows
    ),
    'actual', pg_catalog.jsonb_build_object(
      'total', counts.total_rows,
      'pending', counts.pending_rows,
      'succeeded', counts.succeeded_rows,
      'failed', counts.failed_rows
    )
  ) order by j.created_at, j.id), '[]'::jsonb)
  into v_summary_mismatches
  from public.product_import_jobs j
  cross join lateral (
    select
      pg_catalog.count(*)::integer as total_rows,
      pg_catalog.count(*) filter (where r.status in ('pending', 'processing'))::integer as pending_rows,
      pg_catalog.count(*) filter (where r.status = 'succeeded')::integer as succeeded_rows,
      pg_catalog.count(*) filter (where r.status = 'failed')::integer as failed_rows
    from public.product_import_rows r
    where r.job_id = j.id
  ) counts
  where (p_job_id is null or j.id = p_job_id)
    and (
      j.total_rows <> counts.total_rows
      or j.pending_rows <> counts.pending_rows
      or j.succeeded_rows <> counts.succeeded_rows
      or j.failed_rows <> counts.failed_rows
    );

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'job_id', r.job_id,
    'row_number', r.row_number,
    'operation_id', r.operation_id
  ) order by r.job_id, r.row_number), '[]'::jsonb)
  into v_succeeded_missing_result
  from public.product_import_rows r
  where (p_job_id is null or r.job_id = p_job_id)
    and r.status = 'succeeded'
    and (
      r.product_id is null
      or not exists (
        select 1 from public.product_operations o
        where o.client_request_id = r.operation_id and o.product_id = r.product_id
      )
    );

  return pg_catalog.jsonb_build_object(
    'healthy', pg_catalog.jsonb_array_length(v_summary_mismatches) = 0
      and pg_catalog.jsonb_array_length(v_succeeded_missing_result) = 0,
    'summary_mismatches', v_summary_mismatches,
    'succeeded_rows_missing_product_operation', v_succeeded_missing_result
  );
end;
$$;

create or replace function public.product_import_runtime_health_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start_oid oid := pg_catalog.to_regprocedure('public.product_import_start_rpc(text,text,text,text,text,jsonb,text,text)');
  v_preview_oid oid := pg_catalog.to_regprocedure('public.product_import_preview_rpc(jsonb)');
  v_apply_oid oid := pg_catalog.to_regprocedure('public.product_import_apply_row_rpc(uuid,integer,text,text)');
  v_refresh_oid oid := pg_catalog.to_regprocedure('public.product_import_refresh_job_rpc(uuid)');
  v_reconcile_oid oid := pg_catalog.to_regprocedure('public.product_import_reconciliation_rpc(uuid)');
  v_tables_ready boolean;
  v_functions_ready boolean;
  v_product_ready boolean;
  v_product_create_oid oid := pg_catalog.to_regprocedure('public.product_create_rpc(text,jsonb,jsonb,text,text)');
  v_product_update_oid oid := pg_catalog.to_regprocedure('public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)');
begin
  v_tables_ready := pg_catalog.to_regclass('public.product_import_jobs') is not null
    and pg_catalog.to_regclass('public.product_import_rows') is not null;
  v_functions_ready := v_preview_oid is not null and v_start_oid is not null and v_apply_oid is not null
    and v_refresh_oid is not null and v_reconcile_oid is not null
    and pg_catalog.has_function_privilege('service_role', v_preview_oid, 'execute')
    and pg_catalog.has_function_privilege('service_role', v_start_oid, 'execute')
    and pg_catalog.has_function_privilege('service_role', v_apply_oid, 'execute')
    and pg_catalog.has_function_privilege('service_role', v_refresh_oid, 'execute')
    and pg_catalog.has_function_privilege('service_role', v_reconcile_oid, 'execute');
  v_product_ready := v_product_create_oid is not null
    and v_product_update_oid is not null
    and pg_catalog.has_function_privilege('service_role', v_product_create_oid, 'execute')
    and pg_catalog.has_function_privilege('service_role', v_product_update_oid, 'execute');

  return pg_catalog.jsonb_build_object(
    'ready', v_tables_ready and v_functions_ready and v_product_ready,
    'tables_ready', v_tables_ready,
    'functions_ready', v_functions_ready,
    'product_rpc_ready', v_product_ready,
    'migration_version', '20260716100000'
  );
end;
$$;

revoke all on function public.product_import_start_rpc(text, text, text, text, text, jsonb, text, text)
from public, anon, authenticated;
revoke all on function public.product_import_preview_rpc(jsonb)
from public, anon, authenticated;
revoke all on function public.product_import_apply_row_rpc(uuid, integer, text, text)
from public, anon, authenticated;
revoke all on function public.product_import_refresh_job_rpc(uuid)
from public, anon, authenticated;
revoke all on function public.product_import_reconciliation_rpc(uuid)
from public, anon, authenticated;
revoke all on function public.product_import_runtime_health_rpc()
from public, anon, authenticated;

grant execute on function public.product_import_start_rpc(text, text, text, text, text, jsonb, text, text)
to service_role;
grant execute on function public.product_import_preview_rpc(jsonb)
to service_role;
grant execute on function public.product_import_apply_row_rpc(uuid, integer, text, text)
to service_role;
grant execute on function public.product_import_refresh_job_rpc(uuid)
to service_role;
grant execute on function public.product_import_reconciliation_rpc(uuid)
to service_role;
grant execute on function public.product_import_runtime_health_rpc()
to service_role;

commit;
