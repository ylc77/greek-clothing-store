begin;

create table if not exists public.inventory_operations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  client_request_id text not null,
  operation_type text not null,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  mode text not null,
  requested_quantity integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  quantity_delta integer not null,
  reason text not null,
  source_type text not null,
  source_id text not null,
  actor text not null,
  auto_deactivate boolean not null default false,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint inventory_operations_type_check
    check (operation_type in ('manual', 'stocktake', 'receiving', 'return', 'quick_sell')),
  constraint inventory_operations_mode_check
    check (mode in ('set_to', 'adjust_by')),
  constraint inventory_operations_reason_not_blank_check
    check (btrim(reason) <> ''),
  constraint inventory_operations_actor_not_blank_check
    check (btrim(actor) <> ''),
  constraint inventory_operations_quantity_check
    check (
      quantity_before >= 0
      and quantity_after >= 0
      and quantity_delta = quantity_after - quantity_before
    )
);

create index if not exists inventory_operations_variant_created_idx
  on public.inventory_operations (variant_id, created_at desc);

create index if not exists inventory_operations_source_idx
  on public.inventory_operations (source_type, source_id);

alter table public.inventory_operations enable row level security;
revoke all on table public.inventory_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_operations to service_role;

create or replace function public.inventory_apply_rpc(
  p_client_request_id text,
  p_variant_id uuid,
  p_mode text,
  p_quantity integer,
  p_operation_type text,
  p_reason text,
  p_created_by text,
  p_auto_deactivate boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_mode text := pg_catalog.btrim(coalesce(p_mode, ''));
  v_operation_type text := pg_catalog.btrim(coalesce(p_operation_type, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_created_by text := pg_catalog.btrim(coalesce(p_created_by, ''));
  v_operation_key text;
  v_source_type text;
  v_movement_type text;
  v_location_id uuid;
  v_variant record;
  v_balance record;
  v_existing public.inventory_operations%rowtype;
  v_before integer;
  v_reserved integer;
  v_after integer;
  v_delta integer;
  v_stock integer := 0;
  v_size_stock jsonb := '{"ONE SIZE": 0}'::jsonb;
  v_sizes text := 'ONE SIZE';
  v_product_active boolean;
  v_result jsonb;
begin
  if v_client_request_id = '' or pg_catalog.length(v_client_request_id) > 128 then
    raise exception 'INVENTORY_INVALID_ARGUMENT: clientRequestId must contain 1 to 128 characters';
  end if;
  if p_variant_id is null then
    raise exception 'INVENTORY_INVALID_ARGUMENT: variantId is required';
  end if;
  if v_reason = '' or pg_catalog.length(v_reason) < 3 or pg_catalog.length(v_reason) > 500 then
    raise exception 'INVENTORY_INVALID_ARGUMENT: reason must contain 3 to 500 characters';
  end if;
  if v_created_by = '' or pg_catalog.length(v_created_by) > 200 then
    raise exception 'INVENTORY_INVALID_ARGUMENT: actor is required and must not exceed 200 characters';
  end if;
  if p_quantity is null or pg_catalog.abs(p_quantity::bigint) > 1000000 then
    raise exception 'INVENTORY_INVALID_ARGUMENT: quantity must be an integer between -1000000 and 1000000';
  end if;

  case v_operation_type
    when 'manual' then
      if v_mode not in ('set_to', 'adjust_by') then
        raise exception 'INVENTORY_INVALID_ARGUMENT: manual mode must be set_to or adjust_by';
      end if;
      if v_mode = 'set_to' and p_quantity < 0 then
        raise exception 'INVENTORY_INVALID_ARGUMENT: set_to quantity cannot be negative';
      end if;
      v_source_type := 'admin_inventory_adjustment';
      v_movement_type := 'manual_adjustment';
    when 'stocktake' then
      if v_mode <> 'set_to' or p_quantity < 0 then
        raise exception 'INVENTORY_INVALID_ARGUMENT: stocktake must set a non-negative quantity';
      end if;
      v_source_type := 'admin_stocktake';
      v_movement_type := 'correction';
    when 'receiving' then
      if v_mode <> 'adjust_by' or p_quantity <= 0 then
        raise exception 'INVENTORY_INVALID_ARGUMENT: receiving must add a positive quantity';
      end if;
      v_source_type := 'admin_receiving';
      v_movement_type := 'transfer_in';
    when 'return' then
      if v_mode <> 'adjust_by' or p_quantity <= 0 then
        raise exception 'INVENTORY_INVALID_ARGUMENT: return must add a positive quantity';
      end if;
      v_source_type := 'admin_customer_return';
      v_movement_type := 'return';
    when 'quick_sell' then
      if v_mode <> 'adjust_by' or p_quantity >= 0 then
        raise exception 'INVENTORY_INVALID_ARGUMENT: quick_sell must deduct a negative quantity';
      end if;
      v_source_type := 'quick_sell';
      v_movement_type := 'sale';
    else
      raise exception 'INVENTORY_INVALID_ARGUMENT: invalid operationType';
  end case;

  v_operation_key :=
    case when v_operation_type = 'quick_sell' then 'quick_sell:' else 'inventory:' end
    || v_client_request_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_operation_key, 0)
  );

  select *
    into v_existing
  from public.inventory_operations
  where operation_key = v_operation_key
  for update;

  if found then
    if v_existing.variant_id <> p_variant_id
      or v_existing.operation_type <> v_operation_type
      or v_existing.mode <> v_mode
      or v_existing.requested_quantity <> p_quantity
      or v_existing.reason <> v_reason
      or v_existing.actor <> v_created_by
      or v_existing.auto_deactivate <> coalesce(p_auto_deactivate, false)
    then
      raise exception 'INVENTORY_OPERATION_CONFLICT: operation ID was already used with different parameters';
    end if;

    return pg_catalog.jsonb_set(
      v_existing.result,
      '{alreadyProcessed}',
      'true'::jsonb,
      true
    );
  end if;

  select id
    into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE'
    and active is distinct from false
  limit 1;

  if v_location_id is null then
    raise exception 'INVENTORY_NOT_FOUND: active MAIN_STORE location is missing';
  end if;

  select
    v.id,
    v.product_id,
    v.variant_sku,
    coalesce(nullif(pg_catalog.btrim(v.size), ''), 'ONE SIZE') as size,
    v.active as variant_active,
    p.sku as product_sku,
    p.is_active as product_active
    into v_variant
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id
  for update of v, p;

  if not found then
    raise exception 'INVENTORY_NOT_FOUND: variant was not found';
  end if;

  if v_operation_type = 'quick_sell'
    and (v_variant.product_active is false or v_variant.variant_active is false)
  then
    raise exception 'INVENTORY_INACTIVE: product and variant must both be active';
  end if;

  if v_operation_type <> 'quick_sell' then
    insert into public.inventory_balances (
      variant_id,
      location_id,
      quantity_on_hand,
      quantity_reserved,
      updated_at
    ) values (
      p_variant_id,
      v_location_id,
      0,
      0,
      pg_catalog.now()
    )
    on conflict (variant_id, location_id) do nothing;
  end if;

  select id, quantity_on_hand, quantity_reserved
    into v_balance
  from public.inventory_balances
  where variant_id = p_variant_id
    and location_id = v_location_id
  for update;

  if not found then
    raise exception 'INVENTORY_NOT_FOUND: variant has no MAIN_STORE inventory balance';
  end if;

  v_before := v_balance.quantity_on_hand;
  v_reserved := v_balance.quantity_reserved;

  if v_operation_type = 'quick_sell'
    and (v_before - v_reserved) < (0 - p_quantity)
  then
    raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE: requested %, available %',
      0 - p_quantity,
      greatest(v_before - v_reserved, 0);
  end if;

  v_after :=
    case
      when v_mode = 'set_to' then p_quantity
      else v_before + p_quantity
    end;

  if v_after < 0 then
    raise exception 'INVENTORY_INSUFFICIENT_STOCK: operation would make inventory negative';
  end if;
  if v_after < v_reserved then
    raise exception 'INVENTORY_RESERVED_CONFLICT: resulting on-hand quantity would be below reserved quantity';
  end if;

  v_delta := v_after - v_before;

  insert into public.inventory_operations (
    operation_key,
    client_request_id,
    operation_type,
    variant_id,
    location_id,
    mode,
    requested_quantity,
    quantity_before,
    quantity_after,
    quantity_delta,
    reason,
    source_type,
    source_id,
    actor,
    auto_deactivate,
    result
  ) values (
    v_operation_key,
    v_client_request_id,
    v_operation_type,
    p_variant_id,
    v_location_id,
    v_mode,
    p_quantity,
    v_before,
    v_after,
    v_delta,
    v_reason,
    v_source_type,
    v_operation_key,
    v_created_by,
    coalesce(p_auto_deactivate, false),
    '{}'::jsonb
  );

  if v_delta <> 0 then
    update public.inventory_balances
    set
      quantity_on_hand = v_after,
      updated_at = pg_catalog.now()
    where id = v_balance.id;

    if not found then
      raise exception 'INVENTORY_INVARIANT: locked balance disappeared';
    end if;

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
      p_variant_id,
      v_location_id,
      v_movement_type,
      v_delta,
      v_before,
      v_after,
      v_reason,
      v_source_type,
      v_operation_key,
      v_operation_key,
      v_created_by
    );
  end if;

  with active_variants as (
    select
      coalesce(nullif(pg_catalog.btrim(v.size), ''), 'ONE SIZE') as size,
      v.sort_order,
      coalesce(b.quantity_on_hand, 0)::integer as quantity_on_hand
    from public.product_variants v
    left join public.inventory_balances b
      on b.variant_id = v.id
     and b.location_id = v_location_id
    where v.product_id = v_variant.product_id
      and v.active is distinct from false
  ),
  size_totals as (
    select
      size,
      pg_catalog.min(sort_order) as sort_order,
      pg_catalog.sum(quantity_on_hand)::integer as quantity_on_hand
    from active_variants
    group by size
  )
  select
    coalesce(pg_catalog.sum(quantity_on_hand), 0)::integer,
    coalesce(
      pg_catalog.jsonb_object_agg(size, quantity_on_hand order by sort_order, size),
      '{"ONE SIZE": 0}'::jsonb
    ),
    coalesce(
      pg_catalog.string_agg(size, ',' order by sort_order, size),
      'ONE SIZE'
    )
    into v_stock, v_size_stock, v_sizes
  from size_totals;

  update public.products
  set
    stock = v_stock,
    size_stock = v_size_stock,
    sizes = v_sizes,
    is_active = case
      when v_operation_type = 'quick_sell'
        and coalesce(p_auto_deactivate, false)
        and v_stock = 0
      then false
      else is_active
    end
  where id = v_variant.product_id
  returning is_active into v_product_active;

  if not found then
    raise exception 'INVENTORY_INVARIANT: product disappeared during legacy projection';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'rpc', true,
    'operationId', v_operation_key,
    'alreadyProcessed', false,
    'noChange', v_delta = 0,
    'operationType', v_operation_type,
    'variantId', p_variant_id,
    'variantSku', v_variant.variant_sku,
    'size', v_variant.size,
    'productId', v_variant.product_id,
    'productSku', v_variant.product_sku,
    'quantityBefore', v_before,
    'quantityAfter', v_after,
    'quantityDelta', v_delta,
    'quantityReserved', v_reserved,
    'quantityAvailable', v_after - v_reserved,
    'product', pg_catalog.jsonb_build_object(
      'id', v_variant.product_id,
      'sku', v_variant.product_sku,
      'stock', v_stock,
      'size_stock', v_size_stock,
      'sizes', v_sizes,
      'is_active', v_product_active
    )
  );

  update public.inventory_operations
  set result = v_result
  where operation_key = v_operation_key;

  insert into public.audit_logs (
    actor,
    action,
    entity,
    entity_id,
    before,
    after,
    metadata
  ) values (
    v_created_by,
    'inventory_operation',
    'product_variant',
    p_variant_id::text,
    pg_catalog.jsonb_build_object(
      'quantity_on_hand', v_before,
      'quantity_reserved', v_reserved
    ),
    pg_catalog.jsonb_build_object(
      'quantity_on_hand', v_after,
      'quantity_reserved', v_reserved
    ),
    pg_catalog.jsonb_build_object(
      'operation_key', v_operation_key,
      'operation_type', v_operation_type,
      'mode', v_mode,
      'requested_quantity', p_quantity,
      'source_type', v_source_type,
      'reason', v_reason
    )
  );

  return v_result;
end;
$$;

create or replace function public.inventory_runtime_health_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apply regprocedure := pg_catalog.to_regprocedure(
    'public.inventory_apply_rpc(text,uuid,text,integer,text,text,text,boolean)'
  );
  v_executable boolean := false;
  v_operations_table regclass := pg_catalog.to_regclass('public.inventory_operations');
begin
  if v_apply is not null then
    v_executable := pg_catalog.has_function_privilege('service_role', v_apply, 'EXECUTE');
  end if;

  return pg_catalog.jsonb_build_object(
    'ready', v_apply is not null and v_executable and v_operations_table is not null,
    'version', 'inventory-transaction-v1',
    'apply_deployed', v_apply is not null,
    'apply_executable', v_executable,
    'operations_table_deployed', v_operations_table is not null
  );
end;
$$;

revoke execute on function public.inventory_apply_rpc(
  text, uuid, text, integer, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.inventory_apply_rpc(
  text, uuid, text, integer, text, text, text, boolean
) to service_role;

revoke execute on function public.inventory_runtime_health_rpc()
  from public, anon, authenticated;
grant execute on function public.inventory_runtime_health_rpc()
  to service_role;

commit;
