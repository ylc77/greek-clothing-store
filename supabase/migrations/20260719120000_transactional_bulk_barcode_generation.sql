-- Generate only missing internal Variant barcodes in one payload-bound transaction.
-- Existing barcodes are always preserved. Barcode values remain derived from variant_sku.

create or replace function public.variant_barcodes_generate_missing_rpc(
  p_client_request_id text,
  p_variant_ids jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_fingerprint text;
  v_existing public.barcode_operations%rowtype;
  v_variant_id uuid;
  v_variant record;
  v_barcode text;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_requested integer;
  v_generated integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if v_request_id = '' or pg_catalog.length(v_request_id) > 200 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_REQUEST_ID';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 300 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_ACTOR';
  end if;
  if p_variant_ids is null or pg_catalog.jsonb_typeof(p_variant_ids) <> 'array'
     or pg_catalog.jsonb_array_length(p_variant_ids) < 1
     or pg_catalog.jsonb_array_length(p_variant_ids) > 100 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_VARIANT_IDS';
  end if;

  create temporary table if not exists pg_temp.barcode_variant_ids (
    variant_id uuid primary key
  ) on commit drop;
  truncate pg_temp.barcode_variant_ids;

  begin
    insert into pg_temp.barcode_variant_ids (variant_id)
    select distinct nullif(pg_catalog.btrim(value #>> '{}'), '')::uuid
    from pg_catalog.jsonb_array_elements(p_variant_ids);
  exception when others then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_VARIANT_IDS';
  end;

  select pg_catalog.count(*) into v_requested from pg_temp.barcode_variant_ids;
  if v_requested < 1 or v_requested > 100 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_VARIANT_IDS';
  end if;

  select pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(
      'bulk-missing:' || coalesce(pg_catalog.jsonb_agg(variant_id order by variant_id)::text, '[]'),
      'UTF8'
    ),
    'sha256'::text
  ), 'hex')
  into v_fingerprint
  from pg_temp.barcode_variant_ids;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barcode:' || v_request_id, 0));
  select * into v_existing
  from public.barcode_operations
  where client_request_id = v_request_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint
       or v_existing.actor <> v_actor
       or v_existing.mode <> 'variant_sku' then
      raise exception using errcode = '23505', message = 'BARCODE_OPERATION_CONFLICT';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('already_processed', true);
  end if;

  for v_variant_id in
    select variant_id from pg_temp.barcode_variant_ids order by variant_id
  loop
    select id, variant_sku, barcode
    into v_variant
    from public.product_variants
    where id = v_variant_id
    for update;

    if not found then
      v_failed := v_failed + 1;
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'variantId', v_variant_id,
        'status', 'failed',
        'code', 'BARCODE_VARIANT_NOT_FOUND',
        'message', 'Variant does not exist.'
      ));
      continue;
    end if;

    if nullif(pg_catalog.btrim(coalesce(v_variant.barcode, '')), '') is not null then
      v_skipped := v_skipped + 1;
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'variantId', v_variant.id,
        'variantSku', v_variant.variant_sku,
        'barcode', v_variant.barcode,
        'status', 'skipped_existing'
      ));
      continue;
    end if;

    v_barcode := pg_catalog.btrim(coalesce(v_variant.variant_sku, ''));
    if v_barcode = '' or pg_catalog.length(v_barcode) > 200 then
      v_failed := v_failed + 1;
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'variantId', v_variant.id,
        'variantSku', v_variant.variant_sku,
        'status', 'failed',
        'code', 'BARCODE_INVALID_VARIANT_SKU',
        'message', 'Variant SKU cannot be used as an internal Barcode.'
      ));
      continue;
    end if;

    begin
      update public.product_variants
      set barcode = v_barcode,
          updated_at = pg_catalog.now()
      where id = v_variant.id
        and nullif(pg_catalog.btrim(coalesce(barcode, '')), '') is null;

      if found then
        v_generated := v_generated + 1;
        v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'variantId', v_variant.id,
          'variantSku', v_variant.variant_sku,
          'barcode', v_barcode,
          'status', 'generated'
        ));
      else
        select id, variant_sku, barcode
        into v_variant
        from public.product_variants
        where id = v_variant_id;
        v_skipped := v_skipped + 1;
        v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'variantId', v_variant.id,
          'variantSku', v_variant.variant_sku,
          'barcode', v_variant.barcode,
          'status', 'skipped_existing'
        ));
      end if;
    exception when unique_violation then
      v_failed := v_failed + 1;
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'variantId', v_variant.id,
        'variantSku', v_variant.variant_sku,
        'status', 'failed',
        'code', 'BARCODE_ALREADY_IN_USE',
        'message', 'The generated internal Barcode is already assigned to another Variant.'
      ));
    end;
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'ok', v_failed = 0,
    'requested', v_requested,
    'generated', v_generated,
    'skipped_existing', v_skipped,
    'failed', v_failed,
    'items', v_items,
    'already_processed', false
  );

  insert into public.barcode_operations (client_request_id, payload_fingerprint, actor, mode, result)
  values (v_request_id, v_fingerprint, v_actor, 'variant_sku', v_result);

  insert into public.audit_logs (actor, action, entity, entity_id, metadata)
  values (
    v_actor,
    'variant_barcodes_generated_missing',
    'barcode_operation',
    v_request_id,
    pg_catalog.jsonb_build_object(
      'requested', v_requested,
      'generated', v_generated,
      'skippedExisting', v_skipped,
      'failed', v_failed
    )
  );

  return v_result;
end;
$$;

revoke all on function public.variant_barcodes_generate_missing_rpc(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.variant_barcodes_generate_missing_rpc(text, jsonb, text) to service_role;

comment on function public.variant_barcodes_generate_missing_rpc(text, jsonb, text) is
  'Idempotently generates missing internal Variant Barcodes from immutable Variant SKUs; preserves existing Barcodes and reports per-item outcomes.';
