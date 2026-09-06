begin;

insert into public.inventory_locations (code, name, type, active, sort_order)
values
  ('RETURNS_DAMAGED', 'Damaged returns', 'other', true, 900),
  ('RETURNS_QUARANTINE', 'Returns quarantine', 'other', true, 910)
on conflict (code) do update
set name = excluded.name,
    type = excluded.type,
    active = true,
    updated_at = pg_catalog.now();

create table if not exists public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  original_order_id uuid not null references public.sales_orders(id) on delete restrict,
  client_request_id text not null unique,
  payload_fingerprint text not null,
  status text not null default 'completed',
  reason text not null,
  return_subtotal numeric(12,2) not null default 0,
  exchange_subtotal numeric(12,2) not null default 0,
  balance_delta numeric(12,2) not null default 0,
  external_action text not null default 'none',
  external_method text,
  external_reference text,
  external_confirmed boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz not null default pg_catalog.now(),
  constraint sales_returns_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sales_returns_status_check check (status in ('completed', 'reconciliation_required')),
  constraint sales_returns_reason_check check (pg_catalog.length(pg_catalog.btrim(reason)) >= 3),
  constraint sales_returns_amounts_check check (return_subtotal >= 0 and exchange_subtotal >= 0),
  constraint sales_returns_external_action_check check (external_action in ('none', 'refund', 'collection')),
  constraint sales_returns_external_method_check check (external_method is null or external_method in ('cash', 'card', 'other')),
  constraint sales_returns_external_confirmation_check check (
    (external_action = 'none' and balance_delta = 0 and external_method is null and external_reference is null)
    or
    (external_action <> 'none' and balance_delta <> 0 and external_confirmed and external_method is not null and pg_catalog.btrim(coalesce(external_reference, '')) <> '')
  )
);

create table if not exists public.sales_exchanges (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null unique references public.sales_returns(id) on delete restrict,
  exchange_number text not null unique,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  return_credit_applied numeric(12,2) not null default 0 check (return_credit_applied >= 0),
  amount_due numeric(12,2) not null default 0 check (amount_due >= 0),
  created_by text not null,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists public.sales_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sales_returns(id) on delete restrict,
  original_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_sku text not null,
  variant_sku text not null,
  barcode text,
  name text not null,
  size text,
  color text,
  quantity integer not null check (quantity > 0),
  condition text not null,
  return_amount numeric(12,2) not null check (return_amount >= 0),
  inventory_location_id uuid not null references public.inventory_locations(id) on delete restrict,
  stock_movement_id uuid not null unique references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (return_id, original_order_item_id),
  constraint sales_return_items_condition_check check (condition in ('resellable', 'damaged', 'quarantine'))
);

create table if not exists public.sales_exchange_items (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.sales_exchanges(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_sku text not null,
  variant_sku text not null,
  barcode text,
  name text not null,
  size text,
  color text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  stock_movement_id uuid not null unique references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (exchange_id, variant_id)
);

create index if not exists sales_returns_original_order_idx on public.sales_returns(original_order_id, created_at desc);
create index if not exists sales_return_items_original_item_idx on public.sales_return_items(original_order_item_id);
create index if not exists sales_return_items_variant_idx on public.sales_return_items(variant_id);
create index if not exists sales_exchange_items_variant_idx on public.sales_exchange_items(variant_id);

alter table public.sales_returns enable row level security;
alter table public.sales_exchanges enable row level security;
alter table public.sales_return_items enable row level security;
alter table public.sales_exchange_items enable row level security;

revoke all on table public.sales_returns, public.sales_exchanges, public.sales_return_items, public.sales_exchange_items from public, anon, authenticated;
grant select, insert, update, delete on table public.sales_returns, public.sales_exchanges, public.sales_return_items, public.sales_exchange_items to service_role;

create or replace function app_private.pos_return_exchange_payload(
  p_return_id uuid,
  p_already_processed boolean default false
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'already_processed', coalesce(p_already_processed, false),
    'return', pg_catalog.jsonb_build_object(
      'id', r.id, 'return_number', r.return_number, 'original_order_id', r.original_order_id,
      'status', r.status, 'reason', r.reason, 'return_subtotal', r.return_subtotal,
      'exchange_subtotal', r.exchange_subtotal, 'balance_delta', r.balance_delta,
      'external_action', r.external_action, 'external_method', r.external_method,
      'external_reference', r.external_reference, 'created_by', r.created_by,
      'created_at', r.created_at, 'completed_at', r.completed_at
    ),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id, 'original_order_item_id', i.original_order_item_id,
        'product_id', i.product_id, 'variant_id', i.variant_id,
        'product_sku', i.product_sku, 'variant_sku', i.variant_sku,
        'barcode', i.barcode, 'name', i.name, 'size', i.size, 'color', i.color,
        'quantity', i.quantity, 'condition', i.condition, 'return_amount', i.return_amount,
        'inventory_location_id', i.inventory_location_id, 'stock_movement_id', i.stock_movement_id
      ) order by i.created_at, i.id)
      from public.sales_return_items i where i.return_id = r.id
    ), '[]'::jsonb),
    'exchange', (
      select pg_catalog.jsonb_build_object(
        'id', e.id, 'exchange_number', e.exchange_number, 'subtotal', e.subtotal,
        'return_credit_applied', e.return_credit_applied, 'amount_due', e.amount_due,
        'created_by', e.created_by, 'created_at', e.created_at,
        'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', x.id, 'product_id', x.product_id, 'variant_id', x.variant_id,
          'product_sku', x.product_sku, 'variant_sku', x.variant_sku,
          'barcode', x.barcode, 'name', x.name, 'size', x.size, 'color', x.color,
          'quantity', x.quantity, 'unit_price', x.unit_price, 'line_total', x.line_total,
          'stock_movement_id', x.stock_movement_id
        ) order by x.created_at, x.id) from public.sales_exchange_items x where x.exchange_id = e.id), '[]'::jsonb)
      ) from public.sales_exchanges e where e.return_id = r.id
    ),
    'affected_product_ids', coalesce((
      select pg_catalog.jsonb_agg(distinct affected.product_id)
      from (
        select i.product_id from public.sales_return_items i where i.return_id = r.id
        union
        select x.product_id from public.sales_exchange_items x join public.sales_exchanges e on e.id = x.exchange_id where e.return_id = r.id
      ) affected
    ), '[]'::jsonb),
    'affected_skus', coalesce((
      select pg_catalog.jsonb_agg(distinct affected.product_sku)
      from (
        select i.product_sku from public.sales_return_items i where i.return_id = r.id
        union
        select x.product_sku from public.sales_exchange_items x join public.sales_exchanges e on e.id = x.exchange_id where e.return_id = r.id
      ) affected
      where pg_catalog.btrim(coalesce(affected.product_sku, '')) <> ''
    ), '[]'::jsonb)
  )
  from public.sales_returns r
  where r.id = p_return_id;
$$;

revoke execute on function app_private.pos_return_exchange_payload(uuid, boolean) from public, anon, authenticated;
grant execute on function app_private.pos_return_exchange_payload(uuid, boolean) to service_role;

create or replace function public.pos_return_exchange_rpc(
  p_original_order_id uuid,
  p_client_request_id text,
  p_return_items jsonb,
  p_exchange_items jsonb,
  p_reason text,
  p_external_confirmation jsonb,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_created_by, ''));
  v_existing record;
  v_order record;
  v_return_id uuid;
  v_return_number text;
  v_exchange_id uuid;
  v_exchange_number text;
  v_main_location_id uuid;
  v_damaged_location_id uuid;
  v_quarantine_location_id uuid;
  v_target_location_id uuid;
  v_return_total numeric(12,2) := 0;
  v_exchange_total numeric(12,2) := 0;
  v_delta numeric(12,2) := 0;
  v_expected_delta numeric(12,2);
  v_external_action text := 'none';
  v_external_method text := nullif(pg_catalog.btrim(coalesce(p_external_confirmation->>'method', '')), '');
  v_external_reference text := nullif(pg_catalog.btrim(coalesce(p_external_confirmation->>'reference', '')), '');
  v_external_confirmed boolean := coalesce((p_external_confirmation->>'confirmed')::boolean, false);
  v_fingerprint text;
  v_canonical_returns jsonb;
  v_canonical_exchanges jsonb;
  v_row record;
  v_balance record;
  v_movement_id uuid;
  v_attempt integer;
begin
  if p_original_order_id is null then raise exception 'POS_RETURN_INVALID: original_order_id is required'; end if;
  if v_request_id = '' or pg_catalog.length(v_request_id) > 160 then raise exception 'POS_RETURN_INVALID: client_request_id is required'; end if;
  if pg_catalog.length(v_reason) < 3 or pg_catalog.length(v_reason) > 500 then raise exception 'POS_RETURN_INVALID: reason must be 3 to 500 characters'; end if;
  if v_actor = '' then raise exception 'POS_RETURN_INVALID: created_by is required'; end if;
  if p_return_items is null or pg_catalog.jsonb_typeof(p_return_items) <> 'array' or pg_catalog.jsonb_array_length(p_return_items) = 0 then
    raise exception 'POS_RETURN_INVALID: return_items must be a non-empty array';
  end if;
  if pg_catalog.jsonb_array_length(p_return_items) > 100 then raise exception 'POS_RETURN_INVALID: at most 100 return items are allowed'; end if;
  if p_exchange_items is null then p_exchange_items := '[]'::jsonb; end if;
  if pg_catalog.jsonb_typeof(p_exchange_items) <> 'array' or pg_catalog.jsonb_array_length(p_exchange_items) > 100 then
    raise exception 'POS_RETURN_INVALID: exchange_items must be an array with at most 100 items';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pos_return:' || v_request_id, 0));

  create temporary table if not exists pg_temp.pos_return_input (
    order_item_id uuid primary key, quantity integer not null, condition text not null
  ) on commit drop;
  create temporary table if not exists pg_temp.pos_exchange_input (
    variant_id uuid primary key, quantity integer not null
  ) on commit drop;
  truncate pg_temp.pos_return_input;
  truncate pg_temp.pos_exchange_input;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_return_items) item
    where coalesce(item->>'orderItemId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
       or coalesce(item->>'condition', '') not in ('resellable', 'damaged', 'quarantine')
  ) then raise exception 'POS_RETURN_INVALID: invalid return item'; end if;

  insert into pg_temp.pos_return_input(order_item_id, quantity, condition)
  select (item->>'orderItemId')::uuid, pg_catalog.sum((item->>'quantity')::integer)::integer, pg_catalog.min(item->>'condition')
  from pg_catalog.jsonb_array_elements(p_return_items) item
  group by (item->>'orderItemId')::uuid
  having pg_catalog.count(distinct item->>'condition') = 1;

  if (select pg_catalog.count(*) from pg_temp.pos_return_input) <> (
    select pg_catalog.count(distinct item->>'orderItemId') from pg_catalog.jsonb_array_elements(p_return_items) item
  ) then raise exception 'POS_RETURN_INVALID: duplicate order item has conflicting conditions'; end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_exchange_items) item
    where coalesce(item->>'variantId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
  ) then raise exception 'POS_RETURN_INVALID: invalid exchange item'; end if;

  insert into pg_temp.pos_exchange_input(variant_id, quantity)
  select (item->>'variantId')::uuid, pg_catalog.sum((item->>'quantity')::integer)::integer
  from pg_catalog.jsonb_array_elements(p_exchange_items) item
  group by (item->>'variantId')::uuid;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('orderItemId', order_item_id, 'quantity', quantity, 'condition', condition) order by order_item_id), '[]'::jsonb)
    into v_canonical_returns from pg_temp.pos_return_input;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('variantId', variant_id, 'quantity', quantity) order by variant_id), '[]'::jsonb)
    into v_canonical_exchanges from pg_temp.pos_exchange_input;
  v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'orderId', p_original_order_id, 'returns', v_canonical_returns, 'exchanges', v_canonical_exchanges,
    'reason', v_reason, 'external', pg_catalog.jsonb_build_object('confirmed', v_external_confirmed, 'method', v_external_method, 'reference', v_external_reference)
  )::text, 'UTF8'), 'sha256'), 'hex');

  select id, payload_fingerprint into v_existing from public.sales_returns where client_request_id = v_request_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then raise exception 'POS_RETURN_IDEMPOTENCY_CONFLICT: request payload changed'; end if;
    return app_private.pos_return_exchange_payload(v_existing.id, true);
  end if;

  select o.* into v_order from public.sales_orders o where o.id = p_original_order_id for update;
  if not found then raise exception 'POS_RETURN_NOT_FOUND: original POS order was not found'; end if;
  if v_order.source <> 'pos' then raise exception 'POS_RETURN_CONFLICT: only original POS orders can be returned'; end if;
  if v_order.status <> 'completed' then raise exception 'POS_RETURN_CONFLICT: only completed, non-voided POS orders can be returned'; end if;

  select id into v_main_location_id from public.inventory_locations where code = 'MAIN_STORE' and active limit 1;
  select id into v_damaged_location_id from public.inventory_locations where code = 'RETURNS_DAMAGED' and active limit 1;
  select id into v_quarantine_location_id from public.inventory_locations where code = 'RETURNS_QUARANTINE' and active limit 1;
  if v_main_location_id is null or v_damaged_location_id is null or v_quarantine_location_id is null then
    raise exception 'POS_RETURN_UNAVAILABLE: required inventory locations are missing';
  end if;

  create temporary table if not exists pg_temp.pos_return_rows (
    order_item_id uuid primary key, product_id bigint, variant_id uuid, product_sku text, variant_sku text,
    barcode text, name text, size text, color text, sold_quantity integer, quantity integer,
    condition text, previous_quantity integer, previous_amount numeric(12,2), return_amount numeric(12,2)
  ) on commit drop;
  create temporary table if not exists pg_temp.pos_exchange_rows (
    variant_id uuid primary key, product_id bigint, product_sku text, variant_sku text, barcode text,
    name text, size text, color text, quantity integer, unit_price numeric(12,2), line_total numeric(12,2)
  ) on commit drop;
  truncate pg_temp.pos_return_rows;
  truncate pg_temp.pos_exchange_rows;

  insert into pg_temp.pos_return_rows
  select i.id, i.product_id, i.variant_id, i.product_sku, i.variant_sku, i.barcode, i.name, i.size, i.color,
    i.quantity, input.quantity, input.condition,
    coalesce(previous.quantity, 0), coalesce(previous.amount, 0),
    case when coalesce(previous.quantity, 0) + input.quantity = i.quantity
      then pg_catalog.round(i.line_total - coalesce(previous.amount, 0), 2)
      else pg_catalog.round((i.line_total / i.quantity) * input.quantity, 2)
    end
  from pg_temp.pos_return_input input
  join public.sales_order_items i on i.id = input.order_item_id and i.order_id = p_original_order_id
  left join lateral (
    select pg_catalog.sum(ri.quantity)::integer quantity, pg_catalog.sum(ri.return_amount)::numeric(12,2) amount
    from public.sales_return_items ri join public.sales_returns r on r.id = ri.return_id
    where ri.original_order_item_id = i.id and r.status = 'completed'
  ) previous on true;

  if (select pg_catalog.count(*) from pg_temp.pos_return_rows) <> (select pg_catalog.count(*) from pg_temp.pos_return_input) then
    raise exception 'POS_RETURN_INVALID: a returned item is not part of the original order';
  end if;
  if exists (select 1 from pg_temp.pos_return_rows where previous_quantity + quantity > sold_quantity) then
    raise exception 'POS_RETURN_QUANTITY_EXCEEDED: return quantity exceeds the remaining quantity';
  end if;

  insert into pg_temp.pos_exchange_rows
  select input.variant_id, v.product_id, p.sku, v.variant_sku, v.barcode,
    coalesce(nullif(pg_catalog.btrim(p.name_cn), ''), nullif(pg_catalog.btrim(p.name_en), ''), nullif(pg_catalog.btrim(p.name_gr), ''), p.sku),
    v.size, v.color, input.quantity, pg_catalog.round(coalesce(v.price, p.price, 0), 2),
    pg_catalog.round(coalesce(v.price, p.price, 0) * input.quantity, 2)
  from pg_temp.pos_exchange_input input
  join public.product_variants v on v.id = input.variant_id and v.active
  join public.products p on p.id = v.product_id and p.is_active;

  if (select pg_catalog.count(*) from pg_temp.pos_exchange_rows) <> (select pg_catalog.count(*) from pg_temp.pos_exchange_input) then
    raise exception 'POS_RETURN_INVALID: an exchange Variant is missing or inactive';
  end if;

  select coalesce(pg_catalog.sum(return_amount), 0) into v_return_total from pg_temp.pos_return_rows;
  select coalesce(pg_catalog.sum(line_total), 0) into v_exchange_total from pg_temp.pos_exchange_rows;
  v_delta := pg_catalog.round(v_exchange_total - v_return_total, 2);
  if v_delta > 0 then v_external_action := 'collection';
  elsif v_delta < 0 then v_external_action := 'refund';
  else v_external_action := 'none'; end if;

  if p_external_confirmation ? 'expectedBalanceDelta' then
    begin v_expected_delta := pg_catalog.round((p_external_confirmation->>'expectedBalanceDelta')::numeric, 2);
    exception when others then raise exception 'POS_RETURN_INVALID: expectedBalanceDelta must be numeric'; end;
    if v_expected_delta <> v_delta then raise exception 'POS_RETURN_PRICE_CHANGED: the authoritative amount changed; review again'; end if;
  else raise exception 'POS_RETURN_INVALID: expectedBalanceDelta is required'; end if;

  if v_external_action = 'none' then
    v_external_method := null; v_external_reference := null; v_external_confirmed := false;
  elsif not v_external_confirmed or v_external_method not in ('cash', 'card', 'other') or v_external_reference is null then
    raise exception 'POS_RETURN_EXTERNAL_CONFIRMATION_REQUIRED: confirm the external payment or refund method and reference first';
  end if;

  for v_attempt in 1..5 loop
    begin
      v_return_number := 'RET-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD-HH24MISS') || '-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 6));
      insert into public.sales_returns(return_number, original_order_id, client_request_id, payload_fingerprint, status, reason,
        return_subtotal, exchange_subtotal, balance_delta, external_action, external_method, external_reference,
        external_confirmed, created_by, completed_at)
      values(v_return_number, p_original_order_id, v_request_id, v_fingerprint, 'completed', v_reason,
        v_return_total, v_exchange_total, v_delta, v_external_action, v_external_method, v_external_reference,
        v_external_confirmed, v_actor, pg_catalog.now()) returning id into v_return_id;
      exit;
    exception when unique_violation then
      select id, payload_fingerprint into v_existing from public.sales_returns where client_request_id = v_request_id;
      if found then
        if v_existing.payload_fingerprint <> v_fingerprint then raise exception 'POS_RETURN_IDEMPOTENCY_CONFLICT: request payload changed'; end if;
        return app_private.pos_return_exchange_payload(v_existing.id, true);
      end if;
      if v_attempt = 5 then raise; end if;
    end;
  end loop;

  if exists(select 1 from pg_temp.pos_exchange_rows) then
    v_exchange_number := 'EXC-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD-HH24MISS') || '-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 6));
    insert into public.sales_exchanges(return_id, exchange_number, subtotal, return_credit_applied, amount_due, created_by)
    values(v_return_id, v_exchange_number, v_exchange_total, least(v_return_total, v_exchange_total), greatest(v_delta, 0), v_actor)
    returning id into v_exchange_id;
  end if;

  for v_row in select * from pg_temp.pos_return_rows order by variant_id, condition, order_item_id loop
    v_target_location_id := case v_row.condition when 'resellable' then v_main_location_id when 'damaged' then v_damaged_location_id else v_quarantine_location_id end;
    insert into public.inventory_balances(variant_id, location_id, quantity_on_hand, quantity_reserved)
    values(v_row.variant_id, v_target_location_id, 0, 0) on conflict (variant_id, location_id) do nothing;
    select * into v_balance from public.inventory_balances where variant_id = v_row.variant_id and location_id = v_target_location_id for update;
    update public.inventory_balances set quantity_on_hand = v_balance.quantity_on_hand + v_row.quantity, updated_at = pg_catalog.now() where id = v_balance.id;
    insert into public.stock_movements(variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key, created_by)
    values(v_row.variant_id, v_target_location_id, 'return', v_row.quantity, v_balance.quantity_on_hand,
      v_balance.quantity_on_hand + v_row.quantity, v_reason, 'pos_return', v_return_id::text,
      'pos_return:' || v_request_id || ':' || v_row.order_item_id::text, v_actor) returning id into v_movement_id;
    insert into public.sales_return_items(return_id, original_order_item_id, product_id, variant_id, product_sku, variant_sku,
      barcode, name, size, color, quantity, condition, return_amount, inventory_location_id, stock_movement_id)
    values(v_return_id, v_row.order_item_id, v_row.product_id, v_row.variant_id, v_row.product_sku, v_row.variant_sku,
      v_row.barcode, v_row.name, v_row.size, v_row.color, v_row.quantity, v_row.condition, v_row.return_amount,
      v_target_location_id, v_movement_id);
  end loop;

  for v_row in select * from pg_temp.pos_exchange_rows order by variant_id loop
    select * into v_balance from public.inventory_balances where variant_id = v_row.variant_id and location_id = v_main_location_id for update;
    if not found then raise exception 'POS_RETURN_INSUFFICIENT_STOCK: exchange Variant has no MAIN_STORE balance'; end if;
    if v_balance.quantity_on_hand - v_balance.quantity_reserved < v_row.quantity then
      raise exception 'POS_RETURN_INSUFFICIENT_STOCK: requested %, available % for %', v_row.quantity,
        greatest(v_balance.quantity_on_hand - v_balance.quantity_reserved, 0), v_row.variant_sku;
    end if;
    update public.inventory_balances set quantity_on_hand = v_balance.quantity_on_hand - v_row.quantity, updated_at = pg_catalog.now() where id = v_balance.id;
    insert into public.stock_movements(variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key, created_by)
    values(v_row.variant_id, v_main_location_id, 'sale', -v_row.quantity, v_balance.quantity_on_hand,
      v_balance.quantity_on_hand - v_row.quantity, 'POS exchange: ' || v_reason, 'pos_exchange', v_exchange_id::text,
      'pos_exchange:' || v_request_id || ':' || v_row.variant_id::text, v_actor) returning id into v_movement_id;
    insert into public.sales_exchange_items(exchange_id, product_id, variant_id, product_sku, variant_sku, barcode, name,
      size, color, quantity, unit_price, line_total, stock_movement_id)
    values(v_exchange_id, v_row.product_id, v_row.variant_id, v_row.product_sku, v_row.variant_sku, v_row.barcode, v_row.name,
      v_row.size, v_row.color, v_row.quantity, v_row.unit_price, v_row.line_total, v_movement_id);
  end loop;

  for v_row in
    select distinct product_id from (
      select product_id from pg_temp.pos_return_rows where condition = 'resellable'
      union select product_id from pg_temp.pos_exchange_rows
    ) affected
  loop perform app_private.pos_sync_legacy_stock_from_erp(v_row.product_id); end loop;

  insert into public.audit_logs(actor, action, entity, entity_id, after, metadata)
  values(v_actor, 'pos_return_exchange_completed', 'sales_return', v_return_id::text,
    app_private.pos_return_exchange_payload(v_return_id, false),
    pg_catalog.jsonb_build_object('original_order_id', p_original_order_id, 'client_request_id', v_request_id));

  return app_private.pos_return_exchange_payload(v_return_id, false);
end;
$$;

revoke execute on function public.pos_return_exchange_rpc(uuid, text, jsonb, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.pos_return_exchange_rpc(uuid, text, jsonb, jsonb, text, jsonb, text) to service_role;

create or replace function public.pos_runtime_health_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout regprocedure := pg_catalog.to_regprocedure('public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)');
  v_void regprocedure := pg_catalog.to_regprocedure('public.pos_void_rpc(uuid,text,text,text)');
  v_return regprocedure := pg_catalog.to_regprocedure('public.pos_return_exchange_rpc(uuid,text,jsonb,jsonb,text,jsonb,text)');
  v_checkout_executable boolean := false;
  v_void_executable boolean := false;
  v_return_executable boolean := false;
begin
  if v_checkout is not null then v_checkout_executable := pg_catalog.has_function_privilege('service_role', v_checkout, 'EXECUTE'); end if;
  if v_void is not null then v_void_executable := pg_catalog.has_function_privilege('service_role', v_void, 'EXECUTE'); end if;
  if v_return is not null then v_return_executable := pg_catalog.has_function_privilege('service_role', v_return, 'EXECUTE'); end if;
  return pg_catalog.jsonb_build_object(
    'ready', v_checkout is not null and v_void is not null and v_return is not null and v_checkout_executable and v_void_executable and v_return_executable,
    'version', 'pos-transaction-v3',
    'checkout_deployed', v_checkout is not null, 'checkout_executable', v_checkout_executable,
    'void_deployed', v_void is not null, 'void_executable', v_void_executable,
    'return_exchange_deployed', v_return is not null, 'return_exchange_executable', v_return_executable
  );
end;
$$;

revoke execute on function public.pos_runtime_health_rpc() from public, anon, authenticated;
grant execute on function public.pos_runtime_health_rpc() to service_role;

-- Supabase platform DDL hooks can reapply default grants when later public
-- tables are created. Restore existing append-only ledger boundaries without
-- requiring every legacy installation to have every optional ledger table.
do $$
begin
  if pg_catalog.to_regclass('public.audit_logs') is not null then
    execute 'revoke all on table public.audit_logs from public, anon, authenticated, service_role';
    execute 'grant select on table public.audit_logs to service_role';
  end if;

  if pg_catalog.to_regclass('public.barcode_operations') is not null then
    execute 'revoke all on table public.barcode_operations from public, anon, authenticated, service_role';
    execute 'grant select, insert on table public.barcode_operations to service_role';
  end if;
end;
$$;

commit;
