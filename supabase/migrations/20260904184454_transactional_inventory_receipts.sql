begin;

create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  client_request_id text not null unique,
  payload_fingerprint text not null,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  supplier_reference text,
  status text not null default 'completed',
  received_at timestamptz not null default now(),
  notes text,
  total_units integer not null,
  created_by text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint inventory_receipts_status_check check (status in ('completed', 'cancelled')),
  constraint inventory_receipts_total_units_check check (total_units > 0),
  constraint inventory_receipts_request_not_blank check (btrim(client_request_id) <> ''),
  constraint inventory_receipts_actor_not_blank check (btrim(created_by) <> '')
);

create table public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_received integer not null,
  unit_cost numeric(12,2),
  product_name_snapshot text not null,
  product_sku_snapshot text not null,
  variant_sku_snapshot text not null,
  barcode_snapshot text not null,
  price_snapshot numeric(12,2) not null,
  size_snapshot text,
  color_snapshot text,
  quantity_before integer not null,
  quantity_after integer not null,
  movement_id uuid not null references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (receipt_id, variant_id),
  constraint inventory_receipt_items_quantity_check check (
    quantity_received > 0
    and quantity_before >= 0
    and quantity_after = quantity_before + quantity_received
  ),
  constraint inventory_receipt_items_cost_check check (unit_cost is null or unit_cost >= 0),
  constraint inventory_receipt_items_sku_not_blank check (btrim(variant_sku_snapshot) <> ''),
  constraint inventory_receipt_items_barcode_not_blank check (btrim(barcode_snapshot) <> '')
);

create index inventory_receipts_received_idx on public.inventory_receipts (received_at desc);
create index inventory_receipts_supplier_idx on public.inventory_receipts (supplier_id, received_at desc);
create index inventory_receipt_items_variant_idx on public.inventory_receipt_items (variant_id, created_at desc);

alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_items enable row level security;
revoke all on table public.inventory_receipts, public.inventory_receipt_items from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_receipts, public.inventory_receipt_items to service_role;

create or replace function public.inventory_receipt_complete_rpc(
  p_client_request_id text,
  p_supplier_id uuid,
  p_supplier_reference text,
  p_notes text,
  p_items jsonb,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_supplier_reference text := nullif(pg_catalog.btrim(coalesce(p_supplier_reference, '')), '');
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_actor text := pg_catalog.btrim(coalesce(p_created_by, ''));
  v_fingerprint text;
  v_existing public.inventory_receipts%rowtype;
  v_receipt_id uuid := extensions.gen_random_uuid();
  v_receipt_number text;
  v_location_id uuid;
  v_item record;
  v_variant record;
  v_balance record;
  v_before integer;
  v_after integer;
  v_movement_id uuid;
  v_total_units integer;
  v_count integer;
  v_stock integer;
  v_size_stock jsonb;
  v_sizes text;
  v_items_result jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_request_id = '' or pg_catalog.length(v_request_id) > 128 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: invalid clientRequestId';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 200 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: invalid actor';
  end if;
  if v_supplier_reference is not null and pg_catalog.length(v_supplier_reference) > 160 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: supplier reference is too long';
  end if;
  if v_notes is not null and pg_catalog.length(v_notes) > 500 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: notes are too long';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) < 1
     or pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: items must contain 1 to 100 rows';
  end if;

  create temporary table if not exists pg_temp.receipt_items_input (
    variant_id uuid primary key,
    quantity integer not null,
    unit_cost numeric(12,2)
  ) on commit drop;
  truncate pg_temp.receipt_items_input;

  begin
    insert into pg_temp.receipt_items_input (variant_id, quantity, unit_cost)
    select
      (row.item->>'variantId')::uuid,
      (row.item->>'quantity')::integer,
      case when nullif(row.item->>'unitCost', '') is null then null else (row.item->>'unitCost')::numeric end
    from pg_catalog.jsonb_array_elements(p_items) as row(item);
  exception when unique_violation then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: duplicate Variant';
  when others then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: malformed item';
  end;

  if exists (
    select 1 from pg_temp.receipt_items_input
    where quantity <= 0 or quantity > 1000000 or unit_cost < 0 or unit_cost > 10000000
  ) then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: invalid quantity or unit cost';
  end if;
  select pg_catalog.count(*), pg_catalog.sum(quantity)::integer
  into v_count, v_total_units from pg_temp.receipt_items_input;
  if v_count < 1 or v_count > 100 or v_total_units > 1000000 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECEIPT_INVALID_ARGUMENT: receipt is too large';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    coalesce(p_supplier_id::text, '') || '|' || coalesce(v_supplier_reference, '') || '|' || coalesce(v_notes, '') || '|' ||
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'variantId', variant_id, 'quantity', quantity, 'unitCost', unit_cost
    ) order by variant_id)::text, '[]'), 'UTF8'), 'sha256'::text), 'hex')
  into v_fingerprint from pg_temp.receipt_items_input;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inventory-receipt:' || v_request_id, 0));
  select * into v_existing from public.inventory_receipts where client_request_id = v_request_id for update;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint or v_existing.created_by <> v_actor then
      raise exception using errcode = '23505', message = 'INVENTORY_RECEIPT_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(v_existing.result, '{alreadyProcessed}', 'true'::jsonb, true);
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and active is distinct from false
  ) then
    raise exception using errcode = '23503', message = 'INVENTORY_RECEIPT_SUPPLIER_NOT_FOUND';
  end if;

  select id into v_location_id from public.inventory_locations
  where code = 'MAIN_STORE' and active is distinct from false limit 1;
  if v_location_id is null then
    raise exception using errcode = '23503', message = 'INVENTORY_RECEIPT_RUNTIME_UNAVAILABLE: MAIN_STORE is missing';
  end if;

  if (select count(*) from public.product_variants v join pg_temp.receipt_items_input i on i.variant_id = v.id) <> v_count then
    raise exception using errcode = '23503', message = 'INVENTORY_RECEIPT_VARIANT_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.product_variants v join pg_temp.receipt_items_input i on i.variant_id = v.id
    join public.products p on p.id = v.product_id
    where v.active is false or p.is_active is false or nullif(pg_catalog.btrim(v.variant_sku), '') is null
  ) then
    raise exception using errcode = '23514', message = 'INVENTORY_RECEIPT_VARIANT_INACTIVE';
  end if;

  -- Lock in stable order so concurrent receipts cannot deadlock or lose increments.
  perform v.id from public.product_variants v join pg_temp.receipt_items_input i on i.variant_id = v.id order by v.id for update of v;
  perform p.id from public.products p where p.id in (
    select v.product_id from public.product_variants v join pg_temp.receipt_items_input i on i.variant_id = v.id
  ) order by p.id for update of p;

  -- Missing internal barcodes use the established immutable Variant SKU rule.
  update public.product_variants v set barcode = pg_catalog.btrim(v.variant_sku), updated_at = pg_catalog.now()
  from pg_temp.receipt_items_input i
  where v.id = i.variant_id and nullif(pg_catalog.btrim(coalesce(v.barcode, '')), '') is null;

  v_receipt_number := 'RCV-' || pg_catalog.to_char(pg_catalog.clock_timestamp(), 'YYYYMMDD') || '-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(v_receipt_id::text, '-', ''), 1, 12));
  insert into public.inventory_receipts (
    id, receipt_number, client_request_id, payload_fingerprint, supplier_id,
    supplier_reference, status, notes, total_units, created_by, result
  ) values (
    v_receipt_id, v_receipt_number, v_request_id, v_fingerprint, p_supplier_id,
    v_supplier_reference, 'completed', v_notes, v_total_units, v_actor, '{}'::jsonb
  );

  for v_item in select * from pg_temp.receipt_items_input order by variant_id loop
    select v.id, v.product_id, v.variant_sku, v.barcode, v.size, v.color,
           coalesce(v.price, p.price, 0) as price,
           p.sku as product_sku,
           coalesce(nullif(p.name_en, ''), nullif(p.name_gr, ''), nullif(p.name_cn, ''), p.sku) as product_name
    into v_variant from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = v_item.variant_id;

    insert into public.inventory_balances (variant_id, location_id, quantity_on_hand, quantity_reserved, updated_at)
    values (v_item.variant_id, v_location_id, 0, 0, pg_catalog.now())
    on conflict (variant_id, location_id) do nothing;
    select id, quantity_on_hand, quantity_reserved into v_balance
    from public.inventory_balances where variant_id = v_item.variant_id and location_id = v_location_id for update;
    if not found then raise exception 'INVENTORY_RECEIPT_INVARIANT: balance unavailable'; end if;

    v_before := v_balance.quantity_on_hand;
    v_after := v_before + v_item.quantity;
    update public.inventory_balances set quantity_on_hand = v_after, updated_at = pg_catalog.now() where id = v_balance.id;
    if v_item.unit_cost is not null then
      update public.product_variants set cost_price = v_item.unit_cost, updated_at = pg_catalog.now() where id = v_item.variant_id;
    end if;

    insert into public.stock_movements (
      variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key, created_by
    ) values (
      v_item.variant_id, v_location_id, 'transfer_in', v_item.quantity, v_before, v_after,
      coalesce('Receipt ' || v_supplier_reference, 'Inventory receipt'), 'inventory_receipt', v_receipt_id::text,
      'inventory-receipt:' || v_request_id || ':' || v_item.variant_id::text, v_actor
    ) returning id into v_movement_id;

    insert into public.inventory_receipt_items (
      receipt_id, variant_id, quantity_received, unit_cost, product_name_snapshot, product_sku_snapshot,
      variant_sku_snapshot, barcode_snapshot, price_snapshot, size_snapshot, color_snapshot,
      quantity_before, quantity_after, movement_id
    ) values (
      v_receipt_id, v_item.variant_id, v_item.quantity, v_item.unit_cost, v_variant.product_name,
      v_variant.product_sku, v_variant.variant_sku, v_variant.barcode, v_variant.price,
      v_variant.size, v_variant.color, v_before, v_after, v_movement_id
    );
    v_items_result := v_items_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'variantId', v_item.variant_id, 'productId', v_variant.product_id, 'variantSku', v_variant.variant_sku,
      'barcode', v_variant.barcode, 'size', v_variant.size, 'color', v_variant.color,
      'quantityReceived', v_item.quantity, 'quantityBefore', v_before, 'quantityAfter', v_after,
      'movementId', v_movement_id
    ));
  end loop;

  for v_item in select distinct v.product_id from public.product_variants v join pg_temp.receipt_items_input i on i.variant_id = v.id loop
    with active_variants as (
      select coalesce(nullif(pg_catalog.btrim(v.size), ''), 'ONE SIZE') as size, v.sort_order,
             coalesce(b.quantity_on_hand, 0)::integer as quantity_on_hand
      from public.product_variants v left join public.inventory_balances b
        on b.variant_id = v.id and b.location_id = v_location_id
      where v.product_id = v_item.product_id and v.active is distinct from false
    ), size_totals as (
      select size, pg_catalog.min(sort_order) as sort_order, pg_catalog.sum(quantity_on_hand)::integer quantity_on_hand
      from active_variants group by size
    )
    select coalesce(pg_catalog.sum(quantity_on_hand), 0)::integer,
           coalesce(pg_catalog.jsonb_object_agg(size, quantity_on_hand order by sort_order, size), '{"ONE SIZE":0}'::jsonb),
           coalesce(pg_catalog.string_agg(size, ',' order by sort_order, size), 'ONE SIZE')
    into v_stock, v_size_stock, v_sizes from size_totals;
    update public.products set stock = v_stock, size_stock = v_size_stock, sizes = v_sizes where id = v_item.product_id;
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'rpc', true, 'alreadyProcessed', false, 'receiptId', v_receipt_id,
    'receiptNumber', v_receipt_number, 'totalUnits', v_total_units, 'items', v_items_result
  );
  update public.inventory_receipts set result = v_result where id = v_receipt_id;
  insert into public.audit_logs (actor, action, entity, entity_id, metadata)
  values (v_actor, 'inventory_receipt_completed', 'inventory_receipt', v_receipt_id::text,
    pg_catalog.jsonb_build_object('receiptNumber', v_receipt_number, 'totalUnits', v_total_units, 'itemCount', v_count));
  return v_result;
exception when unique_violation then
  if sqlerrm like '%product_variants_barcode_unique%' then
    raise exception using errcode = '23505', message = 'INVENTORY_RECEIPT_BARCODE_CONFLICT';
  end if;
  raise;
end;
$$;

create or replace function public.inventory_receipt_runtime_health_rpc()
returns jsonb language sql security definer set search_path = '' stable
as $$
  select pg_catalog.jsonb_build_object(
    'ready', pg_catalog.to_regclass('public.inventory_receipts') is not null
      and pg_catalog.to_regclass('public.inventory_receipt_items') is not null
      and pg_catalog.to_regprocedure('public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text)') is not null
      and pg_catalog.has_function_privilege('service_role', 'public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text)', 'EXECUTE'),
    'version', '20260904184454'
  );
$$;

revoke all on function public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text) to service_role;
revoke all on function public.inventory_receipt_runtime_health_rpc() from public, anon, authenticated;
grant execute on function public.inventory_receipt_runtime_health_rpc() to service_role;

-- Supabase's platform DDL hooks may reapply broad service-role table grants
-- when a later public table is created. Restore the pre-existing immutable
-- operations-ledger boundaries explicitly at the end of this migration.
do $$
begin
  if pg_catalog.to_regclass('public.barcode_operations') is not null then
    execute 'revoke all on table public.barcode_operations from service_role';
    execute 'grant select, insert on table public.barcode_operations to service_role';
  end if;
  if pg_catalog.to_regclass('public.audit_logs') is not null then
    execute 'revoke all on table public.audit_logs from service_role';
    execute 'grant select on table public.audit_logs to service_role';
  end if;
end;
$$;

comment on table public.inventory_receipts is 'Atomic, idempotent completed receiving batches.';
comment on function public.inventory_receipt_complete_rpc(text,uuid,text,text,jsonb,text) is
  'Completes one multi-Variant receipt atomically, generates only missing internal barcodes, records movements, and synchronizes legacy stock projections.';

commit;
