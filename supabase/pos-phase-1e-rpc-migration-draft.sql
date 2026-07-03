begin;

create extension if not exists pgcrypto;

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to service_role;

create or replace function app_private.pos_sync_legacy_stock_from_erp(
  p_product_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid;
  v_stock integer := 0;
  v_size_stock jsonb := '{"ONE SIZE": 0}'::jsonb;
  v_sizes text := 'ONE SIZE';
begin
  if p_product_id is null then
    raise exception 'product_id is required';
  end if;

  select id
    into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE'
  limit 1;

  if v_location_id is null then
    raise exception 'MAIN_STORE inventory location is missing';
  end if;

  with active_variants as (
    select
      coalesce(nullif(btrim(v.size), ''), 'ONE SIZE') as size,
      v.sort_order,
      coalesce(b.quantity_on_hand, 0)::integer as quantity_on_hand
    from public.product_variants v
    left join public.inventory_balances b
      on b.variant_id = v.id
     and b.location_id = v_location_id
    where v.product_id = p_product_id
      and v.active is distinct from false
  ),
  size_totals as (
    select
      size,
      min(sort_order) as sort_order,
      sum(quantity_on_hand)::integer as quantity_on_hand
    from active_variants
    group by size
  )
  select
    coalesce(sum(quantity_on_hand), 0)::integer,
    coalesce(jsonb_object_agg(size, quantity_on_hand order by sort_order, size), '{"ONE SIZE": 0}'::jsonb),
    coalesce(string_agg(size, ',' order by sort_order, size), 'ONE SIZE')
    into v_stock, v_size_stock, v_sizes
  from size_totals;

  update public.products
  set
    stock = v_stock,
    size_stock = v_size_stock,
    sizes = v_sizes
  where id = p_product_id;

  if not found then
    raise exception 'product % was not found for legacy stock sync', p_product_id;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'stock', v_stock,
    'size_stock', v_size_stock,
    'sizes', v_sizes
  );
end;
$$;

create or replace function app_private.pos_order_payload(
  p_order_id uuid,
  p_already_processed boolean default false
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'already_processed', coalesce(p_already_processed, false),
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'payment_status', o.payment_status,
      'subtotal', o.subtotal,
      'discount_total', o.discount_total,
      'total', o.total,
      'currency', o.currency,
      'created_at', o.created_at,
      'completed_at', o.completed_at,
      'voided_at', o.voided_at,
      'refunded_at', o.refunded_at
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'product_id', i.product_id,
          'variant_id', i.variant_id,
          'product_sku', i.product_sku,
          'variant_sku', i.variant_sku,
          'barcode', i.barcode,
          'name', i.name,
          'size', i.size,
          'color', i.color,
          'quantity', i.quantity,
          'unit_price', i.unit_price,
          'discount_total', i.discount_total,
          'line_total', i.line_total
        )
        order by i.created_at, i.id
      )
      from public.sales_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'method', p.method,
          'amount', p.amount,
          'currency', p.currency,
          'status', p.status,
          'created_at', p.created_at
        )
        order by p.created_at, p.id
      )
      from public.payments p
      where p.order_id = o.id
    ), '[]'::jsonb),
    'affected_product_ids', coalesce((
      select jsonb_agg(distinct i.product_id)
      from public.sales_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'affected_skus', coalesce((
      select jsonb_agg(distinct i.product_sku)
      from public.sales_order_items i
      where i.order_id = o.id
        and i.product_sku is not null
        and btrim(i.product_sku) <> ''
    ), '[]'::jsonb)
  )
  from public.sales_orders o
  where o.id = p_order_id;
$$;

create or replace function app_private.pos_checkout_rpc(
  p_client_request_id text,
  p_payment_method text,
  p_items jsonb,
  p_discount_total numeric default 0,
  p_notes text default null,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_payment_method text := btrim(coalesce(p_payment_method, ''));
  v_created_by text := nullif(btrim(coalesce(p_created_by, 'admin')), '');
  v_idempotency_key text;
  v_existing_order_id uuid;
  v_location_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_discount_total numeric(10,2) := coalesce(p_discount_total, 0);
  v_total numeric(10,2) := 0;
  v_item_count integer := 0;
  v_row record;
  v_attempt integer;
begin
  if v_client_request_id = '' then
    raise exception 'client_request_id is required';
  end if;

  if v_payment_method not in ('cash', 'card', 'other') then
    raise exception 'payment_method must be cash, card, or other';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty jsonb array';
  end if;

  if v_discount_total < 0 then
    raise exception 'discount_total cannot be negative';
  end if;

  v_idempotency_key := 'pos_sale:' || v_client_request_id;

  select id
    into v_existing_order_id
  from public.sales_orders
  where idempotency_key = v_idempotency_key
  limit 1;

  if v_existing_order_id is not null then
    return app_private.pos_order_payload(v_existing_order_id, true);
  end if;

  select id
    into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE'
  limit 1;

  if v_location_id is null then
    raise exception 'MAIN_STORE inventory location is missing';
  end if;

  create temporary table if not exists pos_rpc_items (
    variant_id uuid primary key,
    quantity integer not null check (quantity > 0)
  ) on commit drop;

  create temporary table if not exists pos_rpc_checkout_rows (
    variant_id uuid primary key,
    product_id bigint not null,
    balance_id uuid not null,
    product_sku text not null,
    variant_sku text not null,
    barcode text,
    name text not null,
    size text,
    color text,
    quantity integer not null,
    unit_price numeric(10,2) not null,
    line_total numeric(10,2) not null,
    quantity_before integer not null,
    quantity_reserved integer not null,
    quantity_after integer not null
  ) on commit drop;

  truncate table pos_rpc_items;
  truncate table pos_rpc_checkout_rows;

  insert into pos_rpc_items (variant_id, quantity)
  select
    coalesce(item->>'variantId', item->>'variant_id')::uuid as variant_id,
    sum((item->>'quantity')::integer)::integer as quantity
  from jsonb_array_elements(p_items) item
  where coalesce(item->>'variantId', item->>'variant_id') is not null
    and (item->>'quantity') ~ '^[0-9]+$'
    and (item->>'quantity')::integer > 0
  group by coalesce(item->>'variantId', item->>'variant_id')::uuid;

  select count(*) into v_item_count from pos_rpc_items;
  if v_item_count = 0 then
    raise exception 'items must include variantId and positive integer quantity';
  end if;

  for v_row in
    select
      i.variant_id,
      i.quantity,
      v.product_id,
      v.variant_sku,
      v.barcode,
      v.size,
      v.color,
      v.price as variant_price,
      v.active as variant_active,
      p.sku as product_sku,
      p.name_cn,
      p.name_en,
      p.name_gr,
      p.price as product_price,
      p.is_active as product_active,
      b.id as balance_id,
      b.quantity_on_hand,
      b.quantity_reserved
    from pos_rpc_items i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    join public.inventory_balances b
      on b.variant_id = v.id
     and b.location_id = v_location_id
    order by i.variant_id
    for update of b
  loop
    if v_row.variant_active is false then
      raise exception 'variant % is inactive', v_row.variant_sku;
    end if;

    if v_row.product_active is false then
      raise exception 'product % is inactive', v_row.product_sku;
    end if;

    if (v_row.quantity_on_hand - v_row.quantity_reserved) < v_row.quantity then
      raise exception 'insufficient stock for %, requested %, available %',
        v_row.variant_sku,
        v_row.quantity,
        greatest(v_row.quantity_on_hand - v_row.quantity_reserved, 0);
    end if;

    insert into pos_rpc_checkout_rows (
      variant_id,
      product_id,
      balance_id,
      product_sku,
      variant_sku,
      barcode,
      name,
      size,
      color,
      quantity,
      unit_price,
      line_total,
      quantity_before,
      quantity_reserved,
      quantity_after
    )
    values (
      v_row.variant_id,
      v_row.product_id,
      v_row.balance_id,
      coalesce(nullif(btrim(v_row.product_sku), ''), v_row.variant_sku),
      v_row.variant_sku,
      nullif(btrim(coalesce(v_row.barcode, '')), ''),
      coalesce(
        nullif(btrim(coalesce(v_row.name_cn, '')), ''),
        nullif(btrim(coalesce(v_row.name_en, '')), ''),
        nullif(btrim(coalesce(v_row.name_gr, '')), ''),
        v_row.product_sku,
        v_row.variant_sku
      ),
      nullif(btrim(coalesce(v_row.size, '')), ''),
      nullif(btrim(coalesce(v_row.color, '')), ''),
      v_row.quantity,
      round(coalesce(v_row.variant_price, v_row.product_price, 0)::numeric, 2),
      round(coalesce(v_row.variant_price, v_row.product_price, 0)::numeric * v_row.quantity, 2),
      v_row.quantity_on_hand,
      v_row.quantity_reserved,
      v_row.quantity_on_hand - v_row.quantity
    );
  end loop;

  if (select count(*) from pos_rpc_checkout_rows) <> v_item_count then
    raise exception 'one or more variants were not found or do not have MAIN_STORE balance';
  end if;

  select coalesce(sum(line_total), 0)::numeric(10,2)
    into v_subtotal
  from pos_rpc_checkout_rows;

  if v_discount_total > v_subtotal then
    raise exception 'discount_total cannot be greater than subtotal';
  end if;

  v_total := round(v_subtotal - v_discount_total, 2);

  for v_attempt in 1..5 loop
    begin
      v_order_number :=
        'POS-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

      insert into public.sales_orders (
        order_number,
        status,
        source,
        subtotal,
        discount_total,
        total,
        currency,
        payment_status,
        idempotency_key,
        created_by,
        notes,
        completed_at
      )
      values (
        v_order_number,
        'completed',
        'pos',
        v_subtotal,
        v_discount_total,
        v_total,
        'EUR',
        'paid',
        v_idempotency_key,
        coalesce(v_created_by, 'admin'),
        nullif(btrim(coalesce(p_notes, '')), ''),
        now()
      )
      returning id into v_order_id;

      exit;
    exception
      when unique_violation then
        select id
          into v_existing_order_id
        from public.sales_orders
        where idempotency_key = v_idempotency_key
        limit 1;

        if v_existing_order_id is not null then
          return app_private.pos_order_payload(v_existing_order_id, true);
        end if;

        if v_attempt = 5 then
          raise;
        end if;
    end;
  end loop;

  insert into public.sales_order_items (
    order_id,
    product_id,
    variant_id,
    product_sku,
    variant_sku,
    barcode,
    name,
    size,
    color,
    quantity,
    unit_price,
    discount_total,
    line_total
  )
  select
    v_order_id,
    product_id,
    variant_id,
    product_sku,
    variant_sku,
    barcode,
    name,
    size,
    color,
    quantity,
    unit_price,
    0,
    line_total
  from pos_rpc_checkout_rows;

  insert into public.payments (
    order_id,
    method,
    amount,
    currency,
    status
  )
  values (
    v_order_id,
    v_payment_method,
    v_total,
    'EUR',
    'paid'
  );

  update public.inventory_balances b
  set
    quantity_on_hand = r.quantity_after,
    updated_at = now()
  from pos_rpc_checkout_rows r
  where b.id = r.balance_id;

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
    'sale',
    0 - r.quantity,
    r.quantity_before,
    r.quantity_after,
    'POS 销售',
    'pos_sale',
    v_order_id::text,
    v_idempotency_key || ':' || r.variant_id::text,
    coalesce(v_created_by, 'admin')
  from pos_rpc_checkout_rows r;

  for v_row in
    select distinct product_id, product_sku
    from pos_rpc_checkout_rows
  loop
    perform app_private.pos_sync_legacy_stock_from_erp(v_row.product_id);
  end loop;

  return app_private.pos_order_payload(v_order_id, false);
end;
$$;

create or replace function app_private.pos_void_rpc(
  p_order_id uuid,
  p_client_request_id text,
  p_reason text,
  p_created_by text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_request_id text := btrim(coalesce(p_client_request_id, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_created_by text := nullif(btrim(coalesce(p_created_by, 'admin')), '');
  v_order record;
  v_location_id uuid;
  v_existing_void_movement_id uuid;
  v_row record;
  v_idempotency_prefix text;
  v_restored_items jsonb := '[]'::jsonb;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  if v_client_request_id = '' then
    raise exception 'client_request_id is required';
  end if;

  if length(v_reason) < 3 then
    raise exception 'reason is required and must be at least 3 characters';
  end if;

  select *
    into v_order
  from public.sales_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'POS order was not found';
  end if;

  if v_order.status = 'voided' then
    return app_private.pos_order_payload(v_order.id, true)
      || jsonb_build_object('restored_items', '[]'::jsonb);
  end if;

  if v_order.status = 'refunded' then
    raise exception 'refunded order cannot be voided';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'only completed orders can be voided';
  end if;

  select id
    into v_existing_void_movement_id
  from public.stock_movements
  where source_type = 'pos_void'
    and source_id = p_order_id::text
  limit 1;

  if v_existing_void_movement_id is not null then
    update public.sales_orders
    set
      status = 'voided',
      payment_status = 'voided',
      voided_at = coalesce(voided_at, now()),
      updated_at = now()
    where id = p_order_id;

    update public.payments
    set status = 'voided'
    where order_id = p_order_id;

    return app_private.pos_order_payload(p_order_id, true)
      || jsonb_build_object('restored_items', '[]'::jsonb);
  end if;

  select id
    into v_location_id
  from public.inventory_locations
  where code = 'MAIN_STORE'
  limit 1;

  if v_location_id is null then
    raise exception 'MAIN_STORE inventory location is missing';
  end if;

  create temporary table if not exists pos_rpc_void_rows (
    variant_id uuid primary key,
    product_id bigint not null,
    product_sku text not null,
    variant_sku text not null,
    quantity integer not null check (quantity > 0),
    balance_id uuid not null,
    quantity_before integer not null,
    quantity_reserved integer not null,
    quantity_after integer not null
  ) on commit drop;

  create temporary table if not exists pos_rpc_void_items (
    variant_id uuid primary key,
    product_id bigint not null,
    product_sku text not null,
    variant_sku text not null,
    quantity integer not null check (quantity > 0)
  ) on commit drop;

  truncate table pos_rpc_void_items;
  truncate table pos_rpc_void_rows;

  insert into pos_rpc_void_items (
    variant_id,
    product_id,
    product_sku,
    variant_sku,
    quantity
  )
  select
    i.variant_id,
    min(i.product_id)::bigint as product_id,
    coalesce(nullif(btrim(min(i.product_sku)), ''), min(i.variant_sku)) as product_sku,
    min(i.variant_sku) as variant_sku,
    sum(i.quantity)::integer as quantity
  from public.sales_order_items i
  where i.order_id = p_order_id
  group by i.variant_id;

  if not exists (select 1 from pos_rpc_void_items) then
    raise exception 'order has no items';
  end if;

  for v_row in
    select
      i.variant_id,
      i.product_id,
      i.product_sku,
      i.variant_sku,
      i.quantity,
      b.id as balance_id,
      b.quantity_on_hand,
      b.quantity_reserved
    from pos_rpc_void_items i
    join public.inventory_balances b
      on b.variant_id = i.variant_id
     and b.location_id = v_location_id
    order by i.variant_id
    for update of b
  loop
    insert into pos_rpc_void_rows (
      variant_id,
      product_id,
      product_sku,
      variant_sku,
      quantity,
      balance_id,
      quantity_before,
      quantity_reserved,
      quantity_after
    )
    values (
      v_row.variant_id,
      v_row.product_id,
      coalesce(nullif(btrim(v_row.product_sku), ''), v_row.variant_sku),
      v_row.variant_sku,
      v_row.quantity,
      v_row.balance_id,
      v_row.quantity_on_hand,
      v_row.quantity_reserved,
      v_row.quantity_on_hand + v_row.quantity
    );
  end loop;

  if (select count(*) from pos_rpc_void_rows) <> (select count(*) from pos_rpc_void_items) then
    raise exception 'order has no items with MAIN_STORE inventory balance';
  end if;

  v_idempotency_prefix := 'pos_void:' || v_client_request_id || ':' || p_order_id::text;

  update public.inventory_balances b
  set
    quantity_on_hand = r.quantity_after,
    updated_at = now()
  from pos_rpc_void_rows r
  where b.id = r.balance_id;

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
    r.quantity,
    r.quantity_before,
    r.quantity_after,
    v_reason,
    'pos_void',
    p_order_id::text,
    v_idempotency_prefix || ':' || r.variant_id::text,
    coalesce(v_created_by, 'admin')
  from pos_rpc_void_rows r;

  for v_row in
    select distinct product_id
    from pos_rpc_void_rows
  loop
    perform app_private.pos_sync_legacy_stock_from_erp(v_row.product_id);
  end loop;

  update public.sales_orders
  set
    status = 'voided',
    payment_status = 'voided',
    voided_at = now(),
    updated_at = now()
  where id = p_order_id;

  update public.payments
  set status = 'voided'
  where order_id = p_order_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'variant_id', variant_id,
      'variant_sku', variant_sku,
      'quantity_before', quantity_before,
      'quantity_after', quantity_after,
      'quantity_delta', quantity
    )
    order by variant_sku
  ), '[]'::jsonb)
    into v_restored_items
  from pos_rpc_void_rows;

  return app_private.pos_order_payload(p_order_id, false)
    || jsonb_build_object('restored_items', v_restored_items);
end;
$$;

revoke all on function app_private.pos_sync_legacy_stock_from_erp(bigint) from public;
revoke all on function app_private.pos_order_payload(uuid, boolean) from public;
revoke all on function app_private.pos_checkout_rpc(text, text, jsonb, numeric, text, text) from public;
revoke all on function app_private.pos_void_rpc(uuid, text, text, text) from public;

revoke execute on function app_private.pos_sync_legacy_stock_from_erp(bigint) from anon, authenticated;
revoke execute on function app_private.pos_order_payload(uuid, boolean) from anon, authenticated;
revoke execute on function app_private.pos_checkout_rpc(text, text, jsonb, numeric, text, text) from anon, authenticated;
revoke execute on function app_private.pos_void_rpc(uuid, text, text, text) from anon, authenticated;

grant execute on function app_private.pos_sync_legacy_stock_from_erp(bigint) to service_role;
grant execute on function app_private.pos_order_payload(uuid, boolean) to service_role;
grant execute on function app_private.pos_checkout_rpc(text, text, jsonb, numeric, text, text) to service_role;
grant execute on function app_private.pos_void_rpc(uuid, text, text, text) to service_role;

commit;
