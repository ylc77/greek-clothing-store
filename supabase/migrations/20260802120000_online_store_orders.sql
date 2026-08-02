begin;

create extension if not exists pgcrypto;

alter table public.business_settings
  add column if not exists online_store_enabled boolean not null default false,
  add column if not exists delivery_enabled boolean not null default true,
  add column if not exists pickup_enabled boolean not null default true,
  add column if not exists shipping_fee numeric(10,2) not null default 0,
  add column if not exists free_shipping_threshold numeric(10,2),
  add column if not exists pickup_instructions_en text,
  add column if not exists pickup_instructions_gr text,
  add column if not exists delivery_instructions_en text,
  add column if not exists delivery_instructions_gr text,
  add column if not exists order_notification_email text;

alter table public.business_settings
  drop constraint if exists business_settings_shipping_fee_check,
  add constraint business_settings_shipping_fee_check check (shipping_fee >= 0),
  drop constraint if exists business_settings_free_shipping_threshold_check,
  add constraint business_settings_free_shipping_threshold_check
    check (free_shipping_threshold is null or free_shipping_threshold >= 0);

create table if not exists public.online_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  status text not null default 'pending',
  fulfillment_method text not null,
  payment_method text not null,
  payment_status text not null default 'pending',
  subtotal numeric(10,2) not null,
  shipping_total numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  currency text not null default 'EUR',
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  address_line1 text,
  city text,
  postal_code text,
  country text not null default 'GR',
  customer_notes text,
  locale text not null default 'el',
  idempotency_key text not null unique,
  request_fingerprint text not null,
  access_token_hash text not null,
  legal_terms_version text,
  privacy_policy_version text,
  legal_accepted_at timestamptz not null,
  confirmed_at timestamptz,
  ready_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_orders_status_check check (
    status in ('pending', 'confirmed', 'ready_for_pickup', 'shipped', 'completed', 'cancelled')
  ),
  constraint online_orders_fulfillment_check check (fulfillment_method in ('delivery', 'pickup')),
  constraint online_orders_payment_method_check check (payment_method in ('cash_on_delivery', 'pay_at_pickup')),
  constraint online_orders_payment_status_check check (payment_status in ('pending', 'paid', 'cancelled')),
  constraint online_orders_amount_check check (subtotal >= 0 and shipping_total >= 0 and total >= 0),
  constraint online_orders_delivery_address_check check (
    fulfillment_method <> 'delivery'
    or (
      nullif(btrim(coalesce(address_line1, '')), '') is not null
      and nullif(btrim(coalesce(city, '')), '') is not null
      and nullif(btrim(coalesce(postal_code, '')), '') is not null
    )
  )
);

create table if not exists public.online_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.online_orders(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_sku text not null,
  variant_sku text not null,
  name_en text not null,
  name_gr text not null,
  size text not null,
  color text not null default '',
  quantity integer not null,
  unit_price numeric(10,2) not null,
  line_total numeric(10,2) not null,
  image_url text,
  created_at timestamptz not null default now(),
  constraint online_order_items_quantity_check check (quantity > 0),
  constraint online_order_items_amount_check check (unit_price >= 0 and line_total >= 0),
  unique (order_id, variant_id)
);

create table if not exists public.online_order_operations (
  operation_id text primary key,
  order_id uuid not null references public.online_orders(id) on delete restrict,
  action text not null,
  request_fingerprint text not null,
  result jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.online_order_rate_limits (
  subject_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint online_order_rate_limits_attempts_check check (attempts >= 0)
);

create index if not exists online_orders_created_at_idx on public.online_orders(created_at desc);
create index if not exists online_orders_status_idx on public.online_orders(status, created_at desc);
create index if not exists online_orders_customer_email_idx on public.online_orders(lower(customer_email));
create index if not exists online_order_items_order_id_idx on public.online_order_items(order_id);
create index if not exists online_order_items_variant_id_idx on public.online_order_items(variant_id);
create index if not exists online_order_operations_order_id_idx on public.online_order_operations(order_id, created_at desc);

alter table public.online_orders enable row level security;
alter table public.online_order_items enable row level security;
alter table public.online_order_operations enable row level security;
alter table public.online_order_rate_limits enable row level security;

revoke all on table public.online_orders from anon, authenticated;
revoke all on table public.online_order_items from anon, authenticated;
revoke all on table public.online_order_operations from anon, authenticated;
revoke all on table public.online_order_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.online_orders to service_role;
grant select, insert, update, delete on table public.online_order_items to service_role;
grant select, insert, update, delete on table public.online_order_operations to service_role;
grant select, insert, update, delete on table public.online_order_rate_limits to service_role;

create or replace function app_private.online_order_payload(p_order_id uuid, p_replayed boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', o.id,
    'orderNumber', o.order_number,
    'status', o.status,
    'fulfillmentMethod', o.fulfillment_method,
    'paymentMethod', o.payment_method,
    'paymentStatus', o.payment_status,
    'subtotal', o.subtotal,
    'shippingTotal', o.shipping_total,
    'total', o.total,
    'currency', o.currency,
    'createdAt', o.created_at,
    'replayed', p_replayed,
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'productSku', i.product_sku,
        'variantSku', i.variant_sku,
        'nameEn', i.name_en,
        'nameGr', i.name_gr,
        'size', i.size,
        'color', i.color,
        'quantity', i.quantity,
        'unitPrice', i.unit_price,
        'lineTotal', i.line_total,
        'imageUrl', i.image_url
      ) order by i.created_at, i.id)
      from public.online_order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.online_orders o
  where o.id = p_order_id;
$$;

revoke all on function app_private.online_order_payload(uuid, boolean)
from public, anon, authenticated, service_role;

create or replace function public.online_order_rate_limit_rpc(
  p_subject_hash text,
  p_limit integer default 10,
  p_window_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_row public.online_order_rate_limits%rowtype;
begin
  if nullif(pg_catalog.btrim(coalesce(p_subject_hash, '')), '') is null
     or p_limit < 1 or p_limit > 100
     or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_RATE_LIMIT_INVALID';
  end if;

  insert into public.online_order_rate_limits(subject_hash, attempts)
  values (p_subject_hash, 0)
  on conflict (subject_hash) do nothing;

  select * into v_row
  from public.online_order_rate_limits
  where subject_hash = p_subject_hash
  for update;

  if v_row.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) then
    update public.online_order_rate_limits
    set window_started_at = v_now, attempts = 1, updated_at = v_now
    where subject_hash = p_subject_hash;
    return pg_catalog.jsonb_build_object('allowed', true, 'remaining', p_limit - 1, 'retryAfter', 0);
  end if;

  update public.online_order_rate_limits
  set attempts = attempts + 1, updated_at = v_now
  where subject_hash = p_subject_hash
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'allowed', v_row.attempts <= p_limit,
    'remaining', greatest(p_limit - v_row.attempts, 0),
    'retryAfter', case
      when v_row.attempts <= p_limit then 0
      else greatest(
        1,
        pg_catalog.ceil(extract(epoch from (v_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) - v_now)))::integer
      )
    end
  );
end;
$$;

revoke all on function public.online_order_rate_limit_rpc(text, integer, integer) from public, anon, authenticated;
grant execute on function public.online_order_rate_limit_rpc(text, integer, integer) to service_role;

create or replace function public.online_order_create_rpc(
  p_operation_id text,
  p_request_fingerprint text,
  p_access_token_hash text,
  p_customer jsonb,
  p_items jsonb,
  p_fulfillment_method text,
  p_payment_method text,
  p_shipping_fee numeric,
  p_free_shipping_threshold numeric,
  p_locale text,
  p_legal_terms_version text,
  p_privacy_policy_version text,
  p_legal_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.online_orders%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_shipping numeric(10,2) := pg_catalog.round(greatest(coalesce(p_shipping_fee, 0), 0), 2);
  v_requested_count integer;
  v_resolved_count integer;
  v_row record;
  v_attempt integer;
  v_customer_name text := pg_catalog.btrim(coalesce(p_customer ->> 'name', ''));
  v_customer_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_customer ->> 'email', '')));
  v_customer_phone text := pg_catalog.btrim(coalesce(p_customer ->> 'phone', ''));
  v_address text := nullif(pg_catalog.btrim(coalesce(p_customer ->> 'addressLine1', '')), '');
  v_city text := nullif(pg_catalog.btrim(coalesce(p_customer ->> 'city', '')), '');
  v_postal_code text := nullif(pg_catalog.btrim(coalesce(p_customer ->> 'postalCode', '')), '');
begin
  if nullif(pg_catalog.btrim(coalesce(p_operation_id, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_request_fingerprint, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_access_token_hash, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_IDENTITY';
  end if;

  select * into v_existing from public.online_orders where idempotency_key = p_operation_id;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint
       or v_existing.access_token_hash <> p_access_token_hash then
      raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_IDEMPOTENCY_CONFLICT';
    end if;
    return app_private.online_order_payload(v_existing.id, true);
  end if;

  if p_fulfillment_method not in ('delivery', 'pickup')
     or p_payment_method not in ('cash_on_delivery', 'pay_at_pickup')
     or (p_fulfillment_method = 'delivery' and p_payment_method <> 'cash_on_delivery')
     or (p_fulfillment_method = 'pickup' and p_payment_method <> 'pay_at_pickup') then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_FULFILLMENT';
  end if;

  if pg_catalog.length(v_customer_name) < 2 or pg_catalog.length(v_customer_name) > 120
     or pg_catalog.length(v_customer_email) < 5 or pg_catalog.length(v_customer_email) > 200
     or pg_catalog.length(v_customer_phone) < 6 or pg_catalog.length(v_customer_phone) > 40 then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_CUSTOMER';
  end if;
  if p_fulfillment_method = 'delivery' and (v_address is null or v_city is null or v_postal_code is null) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_DELIVERY_ADDRESS_REQUIRED';
  end if;
  if p_legal_accepted_at is null
     or nullif(pg_catalog.btrim(coalesce(p_legal_terms_version, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_privacy_policy_version, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_LEGAL_ACCEPTANCE_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) < 1 or pg_catalog.jsonb_array_length(p_items) > 25 then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_ITEMS';
  end if;

  create temporary table if not exists online_order_resolved_items (
    product_id bigint not null,
    variant_id uuid not null,
    product_sku text not null,
    variant_sku text not null,
    name_en text not null,
    name_gr text not null,
    size text not null,
    color text not null,
    image_url text,
    quantity integer not null,
    unit_price numeric(10,2) not null,
    line_total numeric(10,2) not null,
    balance_id uuid not null,
    quantity_on_hand integer not null,
    quantity_reserved integer not null,
    primary key (variant_id)
  ) on commit drop;
  truncate table online_order_resolved_items;

  create temporary table if not exists online_order_requested_items (
    product_sku_key text not null,
    size_key text not null,
    color_key text not null,
    quantity integer not null,
    primary key (product_sku_key, size_key, color_key)
  ) on commit drop;
  truncate table online_order_requested_items;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) item(value)
    where pg_catalog.jsonb_typeof(value) <> 'object'
       or nullif(pg_catalog.btrim(coalesce(value ->> 'productSku', '')), '') is null
       or coalesce(value ->> 'quantity', '') !~ '^[1-9][0-9]*$'
       or (value ->> 'quantity')::integer > 20
       or pg_catalog.length(pg_catalog.btrim(coalesce(value ->> 'size', ''))) > 60
       or pg_catalog.length(pg_catalog.btrim(coalesce(value ->> 'color', ''))) > 100
  ) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_ITEMS';
  end if;

  insert into online_order_requested_items(product_sku_key, size_key, color_key, quantity)
  select
    pg_catalog.lower(pg_catalog.btrim(value ->> 'productSku')),
    pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(value ->> 'size', ''), 'ONE SIZE'))),
    pg_catalog.lower(pg_catalog.btrim(coalesce(value ->> 'color', ''))),
    pg_catalog.sum((value ->> 'quantity')::integer)::integer
  from pg_catalog.jsonb_array_elements(p_items) item(value)
  group by 1,2,3;

  if exists (select 1 from online_order_requested_items where quantity > 20) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_ITEMS';
  end if;

  select count(*) into v_requested_count from online_order_requested_items;

  if v_requested_count < 1 or v_requested_count > 25 then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_ITEMS';
  end if;

  insert into online_order_resolved_items
  select
    p.id,
    v.id,
    p.sku,
    v.variant_sku,
    coalesce(nullif(p.name_en, ''), nullif(p.name_gr, ''), p.sku),
    coalesce(nullif(p.name_gr, ''), nullif(p.name_en, ''), p.sku),
    pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))),
    pg_catalog.btrim(coalesce(v.color, '')),
    nullif(p.image_url, ''),
    r.quantity,
    pg_catalog.round(coalesce(v.price, p.price, 0)::numeric, 2),
    pg_catalog.round(coalesce(v.price, p.price, 0)::numeric * r.quantity, 2),
    b.id,
    b.quantity_on_hand,
    b.quantity_reserved
  from online_order_requested_items r
  join public.products p on pg_catalog.lower(pg_catalog.btrim(p.sku)) = r.product_sku_key and p.is_active is distinct from false
  join public.product_variants v on v.product_id = p.id and v.active
    and pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))) = r.size_key
    and pg_catalog.lower(pg_catalog.btrim(coalesce(v.color, ''))) = r.color_key
  join public.inventory_locations l on l.code = 'MAIN_STORE' and l.active
  join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
  where r.quantity between 1 and 20
  order by v.id
  for update of b;

  select count(*) into v_resolved_count from online_order_resolved_items;
  if v_resolved_count <> v_requested_count then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_ITEM_UNAVAILABLE';
  end if;

  for v_row in select * from online_order_resolved_items order by variant_id loop
    if v_row.quantity_on_hand - v_row.quantity_reserved < v_row.quantity then
      raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INSUFFICIENT_STOCK';
    end if;
  end loop;

  select coalesce(pg_catalog.sum(line_total), 0)::numeric(10,2) into v_subtotal from online_order_resolved_items;
  if p_fulfillment_method = 'pickup'
     or (p_free_shipping_threshold is not null and v_subtotal >= greatest(p_free_shipping_threshold, 0)) then
    v_shipping := 0;
  end if;

  for v_attempt in 1..5 loop
    begin
      v_order_number := 'WEB-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD-HH24MISS') || '-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6));
      insert into public.online_orders(
        order_number, fulfillment_method, payment_method, subtotal, shipping_total, total,
        customer_name, customer_email, customer_phone, address_line1, city, postal_code,
        customer_notes, locale, idempotency_key, request_fingerprint, access_token_hash,
        legal_terms_version, privacy_policy_version, legal_accepted_at
      ) values (
        v_order_number, p_fulfillment_method, p_payment_method, v_subtotal, v_shipping, v_subtotal + v_shipping,
        v_customer_name, v_customer_email, v_customer_phone, v_address, v_city, v_postal_code,
        nullif(pg_catalog.btrim(coalesce(p_customer ->> 'notes', '')), ''),
        case when p_locale = 'en' then 'en' else 'el' end,
        p_operation_id, p_request_fingerprint, p_access_token_hash,
        p_legal_terms_version, p_privacy_policy_version, p_legal_accepted_at
      ) returning id into v_order_id;
      exit;
    exception when unique_violation then
      select * into v_existing from public.online_orders where idempotency_key = p_operation_id;
      if found then
        if v_existing.request_fingerprint <> p_request_fingerprint or v_existing.access_token_hash <> p_access_token_hash then
          raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_IDEMPOTENCY_CONFLICT';
        end if;
        return app_private.online_order_payload(v_existing.id, true);
      end if;
      if v_attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.online_order_items(
    order_id, product_id, variant_id, product_sku, variant_sku, name_en, name_gr,
    size, color, quantity, unit_price, line_total, image_url
  )
  select v_order_id, product_id, variant_id, product_sku, variant_sku, name_en, name_gr,
    size, color, quantity, unit_price, line_total, image_url
  from online_order_resolved_items;

  for v_row in select * from online_order_resolved_items order by variant_id loop
    update public.inventory_balances
    set quantity_reserved = quantity_reserved + v_row.quantity, updated_at = pg_catalog.now()
    where id = v_row.balance_id;

    insert into public.stock_movements(
      variant_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after,
      reason, source_type, source_id, idempotency_key, created_by
    ) select
      v_row.variant_id, l.id, 'reservation', 0, v_row.quantity_on_hand, v_row.quantity_on_hand,
      'Online order inventory reservation', 'online_order', v_order_id::text,
      p_operation_id || ':' || v_row.variant_id::text || ':reserve', 'storefront'
    from public.inventory_locations l where l.code = 'MAIN_STORE' and l.active;
  end loop;

  return app_private.online_order_payload(v_order_id, false);
end;
$$;

revoke all on function public.online_order_create_rpc(text,text,text,jsonb,jsonb,text,text,numeric,numeric,text,text,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.online_order_create_rpc(text,text,text,jsonb,jsonb,text,text,numeric,numeric,text,text,text,timestamptz)
to service_role;

create or replace function public.online_order_transition_rpc(
  p_order_id uuid,
  p_target_status text,
  p_operation_id text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.online_orders%rowtype;
  v_existing public.online_order_operations%rowtype;
  v_row record;
  v_result jsonb;
begin
  if nullif(pg_catalog.btrim(coalesce(p_operation_id, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_actor, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_OPERATION';
  end if;
  select * into v_existing from public.online_order_operations where operation_id = p_operation_id;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.action <> p_target_status then
      raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_OPERATION_CONFLICT';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select * into v_order from public.online_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_NOT_FOUND'; end if;
  if v_order.status = p_target_status then return app_private.online_order_payload(v_order.id, true); end if;

  if p_target_status = 'confirmed' and v_order.status = 'pending' then
    update public.online_orders set status='confirmed', confirmed_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status = 'ready_for_pickup' and v_order.status = 'confirmed' and v_order.fulfillment_method = 'pickup' then
    update public.online_orders set status='ready_for_pickup', ready_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status = 'shipped' and v_order.status = 'confirmed' and v_order.fulfillment_method = 'delivery' then
    update public.online_orders set status='shipped', shipped_at=pg_catalog.now(), updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status = 'cancelled' and v_order.status in ('pending','confirmed','ready_for_pickup') then
    for v_row in
      select i.variant_id, i.quantity, b.id as balance_id, b.quantity_on_hand, b.quantity_reserved, l.id as location_id
      from public.online_order_items i
      join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id order by i.variant_id for update of b
    loop
      if v_row.quantity_reserved < v_row.quantity then
        raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_RECONCILIATION_REQUIRED';
      end if;
      update public.inventory_balances set quantity_reserved=quantity_reserved-v_row.quantity, updated_at=pg_catalog.now() where id=v_row.balance_id;
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by)
      values(v_row.variant_id,v_row.location_id,'release_reservation',0,v_row.quantity_on_hand,v_row.quantity_on_hand,'Online order cancelled','online_order',v_order.id::text,p_operation_id||':'||v_row.variant_id::text||':release',p_actor);
    end loop;
    update public.online_orders set status='cancelled',payment_status='cancelled',cancelled_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status = 'completed' and ((v_order.status='ready_for_pickup' and v_order.fulfillment_method='pickup') or (v_order.status='shipped' and v_order.fulfillment_method='delivery')) then
    for v_row in
      select i.product_id,i.variant_id,i.quantity,b.id as balance_id,b.quantity_on_hand,b.quantity_reserved,l.id as location_id
      from public.online_order_items i
      join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id order by i.variant_id for update of b
    loop
      if v_row.quantity_reserved < v_row.quantity or v_row.quantity_on_hand < v_row.quantity then
        raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_RECONCILIATION_REQUIRED';
      end if;
      update public.inventory_balances
      set quantity_on_hand=quantity_on_hand-v_row.quantity,quantity_reserved=quantity_reserved-v_row.quantity,updated_at=pg_catalog.now()
      where id=v_row.balance_id;
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by)
      values(v_row.variant_id,v_row.location_id,'sale',0-v_row.quantity,v_row.quantity_on_hand,v_row.quantity_on_hand-v_row.quantity,'Online order completed','online_order',v_order.id::text,p_operation_id||':'||v_row.variant_id::text||':sale',p_actor);
      update public.products set stock=stock,sizes=sizes,size_stock=size_stock where id=v_row.product_id;
    end loop;
    update public.online_orders set status='completed',payment_status='paid',completed_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_order.id;
  else
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_TRANSITION';
  end if;

  v_result := app_private.online_order_payload(v_order.id, false);
  insert into public.online_order_operations(operation_id,order_id,action,request_fingerprint,result,actor)
  values(p_operation_id,v_order.id,p_target_status,p_target_status,v_result,p_actor);
  return v_result;
end;
$$;

revoke all on function public.online_order_transition_rpc(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.online_order_transition_rpc(uuid,text,text,text) to service_role;

-- The storefront needs the same server-authoritative Variant price used by the
-- checkout transaction so the cart never displays a stale product base price.
create or replace function public.product_public_variants_rpc(p_product_sku text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sku text := pg_catalog.btrim(coalesce(p_product_sku, ''));
  v_result jsonb;
begin
  if v_sku = '' or pg_catalog.length(v_sku) > 200 then return '[]'::jsonb; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'size', pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))),
    'color', pg_catalog.btrim(coalesce(v.color, '')),
    'price', pg_catalog.round(coalesce(v.price, p.price, 0)::numeric, 2),
    'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0)
  ) order by v.sort_order, v.id), '[]'::jsonb) into v_result
  from public.products p
  join public.product_variants v on v.product_id=p.id and v.active
  join public.inventory_locations l on l.code='MAIN_STORE' and l.active
  left join public.inventory_balances b on b.variant_id=v.id and b.location_id=l.id
  where pg_catalog.lower(pg_catalog.btrim(p.sku))=pg_catalog.lower(v_sku)
    and p.is_active is distinct from false;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.product_public_variants_rpc(text) from public;
grant execute on function public.product_public_variants_rpc(text) to anon, authenticated, service_role;

create or replace function public.product_public_variants_batch_rpc(p_product_skus text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select distinct pg_catalog.btrim(value) as sku
    from pg_catalog.unnest(coalesce(p_product_skus, '{}'::text[])) as input(value)
    where pg_catalog.btrim(value) <> '' and pg_catalog.length(pg_catalog.btrim(value)) <= 200
    limit 20
  ), variant_rows as (
    select p.sku, v.sort_order, v.id, pg_catalog.jsonb_build_object(
      'size', pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))),
      'color', pg_catalog.btrim(coalesce(v.color, '')),
      'price', pg_catalog.round(coalesce(v.price, p.price, 0)::numeric, 2),
      'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0)
    ) as item
    from requested r
    join public.products p on pg_catalog.lower(pg_catalog.btrim(p.sku))=pg_catalog.lower(r.sku) and p.is_active is distinct from false
    join public.product_variants v on v.product_id=p.id and v.active
    join public.inventory_locations l on l.code='MAIN_STORE' and l.active
    left join public.inventory_balances b on b.variant_id=v.id and b.location_id=l.id
  ), grouped as (
    select sku, pg_catalog.jsonb_agg(item order by sort_order,id) as variants from variant_rows group by sku
  )
  select coalesce(pg_catalog.jsonb_object_agg(sku,variants), '{}'::jsonb) from grouped;
$$;

revoke all on function public.product_public_variants_batch_rpc(text[]) from public;
grant execute on function public.product_public_variants_batch_rpc(text[]) to anon, authenticated, service_role;

commit;
