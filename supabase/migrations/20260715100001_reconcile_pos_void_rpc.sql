begin;

create or replace function public.pos_void_rpc(
  p_order_id uuid,
  p_client_request_id text,
  p_reason text,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_created_by text := nullif(pg_catalog.btrim(coalesce(p_created_by, '')), '');
  v_order_status text;
  v_location_id uuid;
  v_row record;
  v_expected_count integer;
  v_existing_count integer;
  v_missing_count integer;
  v_restored_items jsonb := '[]'::jsonb;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;
  if v_client_request_id = '' then
    raise exception 'client_request_id is required';
  end if;
  if pg_catalog.length(v_reason) < 3 then
    raise exception 'reason is required and must be at least 3 characters';
  end if;
  if v_created_by is null then
    raise exception 'created_by is required';
  end if;

  select o.status
    into v_order_status
  from public.sales_orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'POS order was not found';
  end if;
  if v_order_status = 'refunded' then
    raise exception 'refunded order cannot be voided';
  end if;
  if v_order_status not in ('completed', 'voided') then
    raise exception 'only completed orders can be voided';
  end if;

  select l.id
    into v_location_id
  from public.inventory_locations l
  where l.code = 'MAIN_STORE'
  limit 1;

  if v_location_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: MAIN_STORE inventory location is missing';
  end if;

  create temporary table if not exists pg_temp.pos_void_expected (
    variant_id uuid primary key,
    product_id bigint not null,
    product_sku text not null,
    variant_sku text not null,
    expected_quantity integer not null check (expected_quantity > 0),
    restored_quantity integer not null default 0,
    missing_quantity integer not null default 0
  ) on commit drop;

  create temporary table if not exists pg_temp.pos_void_rows (
    variant_id uuid primary key,
    product_id bigint not null,
    product_sku text not null,
    variant_sku text not null,
    balance_id uuid not null,
    restored_quantity integer not null,
    missing_quantity integer not null,
    quantity_before integer not null,
    quantity_after integer not null
  ) on commit drop;

  truncate table pg_temp.pos_void_expected;
  truncate table pg_temp.pos_void_rows;

  insert into pg_temp.pos_void_expected (
    variant_id,
    product_id,
    product_sku,
    variant_sku,
    expected_quantity
  )
  select
    i.variant_id,
    pg_catalog.min(i.product_id)::bigint,
    coalesce(nullif(pg_catalog.btrim(pg_catalog.min(i.product_sku)), ''), pg_catalog.min(i.variant_sku)),
    pg_catalog.min(i.variant_sku),
    pg_catalog.sum(i.quantity)::integer
  from public.sales_order_items i
  where i.order_id = p_order_id
  group by i.variant_id;

  select pg_catalog.count(*)::integer
    into v_expected_count
  from pg_temp.pos_void_expected;

  if v_expected_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: order has no item quantities to restore';
  end if;

  if exists (
    select 1
    from public.stock_movements m
    left join pg_temp.pos_void_expected e on e.variant_id = m.variant_id
    where m.source_type = 'pos_void'
      and m.source_id = p_order_id::text
      and (
        e.variant_id is null
        or m.location_id <> v_location_id
        or m.movement_type <> 'return'
        or m.quantity_delta <= 0
        or m.quantity_after <> m.quantity_before + m.quantity_delta
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: existing void movements are inconsistent';
  end if;

  update pg_temp.pos_void_expected e
  set restored_quantity = restored.quantity
  from (
    select m.variant_id, pg_catalog.sum(m.quantity_delta)::integer as quantity
    from public.stock_movements m
    where m.source_type = 'pos_void'
      and m.source_id = p_order_id::text
    group by m.variant_id
  ) restored
  where restored.variant_id = e.variant_id;

  if exists (
    select 1
    from pg_temp.pos_void_expected e
    where e.restored_quantity < 0
       or e.restored_quantity > e.expected_quantity
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: restored quantity exceeds the order quantity';
  end if;

  update pg_temp.pos_void_expected
  set missing_quantity = expected_quantity - restored_quantity
  where true;

  select pg_catalog.count(*)::integer
    into v_existing_count
  from public.stock_movements m
  where m.source_type = 'pos_void'
    and m.source_id = p_order_id::text;

  -- A row marked voided without any restoration ledger cannot be safely
  -- distinguished from an old partial JS write that failed before movement
  -- insertion. Stop and require reconciliation instead of adding stock again.
  if v_order_status = 'voided' and v_existing_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: voided order has no restoration movements';
  end if;

  if exists (
    select 1
    from pg_temp.pos_void_expected e
    left join public.inventory_balances b
      on b.variant_id = e.variant_id
     and b.location_id = v_location_id
    where b.id is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: an order variant has no MAIN_STORE balance';
  end if;

  for v_row in
    select
      e.variant_id,
      e.product_id,
      e.product_sku,
      e.variant_sku,
      e.restored_quantity,
      e.missing_quantity,
      b.id as balance_id,
      b.quantity_on_hand
    from pg_temp.pos_void_expected e
    join public.inventory_balances b
      on b.variant_id = e.variant_id
     and b.location_id = v_location_id
    order by e.variant_id
    for update of b
  loop
    insert into pg_temp.pos_void_rows (
      variant_id,
      product_id,
      product_sku,
      variant_sku,
      balance_id,
      restored_quantity,
      missing_quantity,
      quantity_before,
      quantity_after
    ) values (
      v_row.variant_id,
      v_row.product_id,
      v_row.product_sku,
      v_row.variant_sku,
      v_row.balance_id,
      v_row.restored_quantity,
      v_row.missing_quantity,
      v_row.quantity_on_hand,
      v_row.quantity_on_hand + v_row.missing_quantity
    );
  end loop;

  if (select pg_catalog.count(*) from pg_temp.pos_void_rows) <> v_expected_count then
    raise exception using
      errcode = 'P0001',
      message = 'POS_VOID_RECONCILIATION_REQUIRED: not every order variant could be locked';
  end if;

  select pg_catalog.count(*)::integer
    into v_missing_count
  from pg_temp.pos_void_rows
  where missing_quantity > 0;

  if v_missing_count > 0 then
    update public.inventory_balances b
    set
      quantity_on_hand = r.quantity_after,
      updated_at = pg_catalog.now()
    from pg_temp.pos_void_rows r
    where b.id = r.balance_id
      and r.missing_quantity > 0;

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
    )
    select
      r.variant_id,
      v_location_id,
      'return',
      r.missing_quantity,
      r.quantity_before,
      r.quantity_after,
      v_reason,
      'pos_void',
      p_order_id::text,
      'pos_void:' || v_client_request_id || ':' || p_order_id::text || ':' || r.variant_id::text,
      v_created_by
    from pg_temp.pos_void_rows r
    where r.missing_quantity > 0;

    for v_row in
      select distinct r.product_id
      from pg_temp.pos_void_rows r
      where r.missing_quantity > 0
    loop
      perform app_private.pos_sync_legacy_stock_from_erp(v_row.product_id);
    end loop;
  end if;

  update public.sales_orders
  set
    status = 'voided',
    payment_status = 'voided',
    voided_at = coalesce(voided_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where id = p_order_id;

  update public.payments
  set status = 'voided'
  where order_id = p_order_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant_id', r.variant_id,
        'variant_sku', r.variant_sku,
        'quantity_before', r.quantity_before,
        'quantity_after', r.quantity_after,
        'quantity_delta', r.missing_quantity,
        'previously_restored', r.restored_quantity
      ) order by r.variant_sku
    ) filter (where r.missing_quantity > 0),
    '[]'::jsonb
  )
    into v_restored_items
  from pg_temp.pos_void_rows r;

  return app_private.pos_order_payload(p_order_id, v_missing_count = 0)
    || pg_catalog.jsonb_build_object('restored_items', v_restored_items);
end;
$$;

revoke execute on function public.pos_void_rpc(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.pos_void_rpc(uuid, text, text, text)
  to service_role;

commit;
