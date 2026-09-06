begin;

alter table public.business_settings
  add column if not exists viva_payments_enabled boolean not null default false,
  add column if not exists boxnow_enabled boolean not null default false,
  add column if not exists boxnow_minimum_subtotal numeric(10,2) not null default 15.00,
  add column if not exists boxnow_shipping_fee numeric(10,2) not null default 2.50,
  add column if not exists boxnow_free_shipping_threshold numeric(10,2) default 39.00,
  add column if not exists boxnow_max_items integer not null default 10,
  add column if not exists boxnow_max_weight_grams integer not null default 20000,
  add column if not exists boxnow_max_length_mm integer not null default 600,
  add column if not exists boxnow_max_width_mm integer not null default 450,
  add column if not exists boxnow_max_height_mm integer not null default 360,
  add column if not exists pickup_hold_days integer not null default 3;

alter table public.business_settings
  drop constraint if exists business_settings_boxnow_amounts_check,
  add constraint business_settings_boxnow_amounts_check check (
    boxnow_minimum_subtotal >= 0
    and boxnow_shipping_fee >= 0
    and (boxnow_free_shipping_threshold is null or boxnow_free_shipping_threshold >= 0)
  ),
  drop constraint if exists business_settings_boxnow_limits_check,
  add constraint business_settings_boxnow_limits_check check (
    boxnow_max_items between 1 and 100
    and boxnow_max_weight_grams between 1 and 100000
    and boxnow_max_length_mm between 1 and 2000
    and boxnow_max_width_mm between 1 and 2000
    and boxnow_max_height_mm between 1 and 2000
    and pickup_hold_days between 1 and 30
  );

alter table public.products
  add column if not exists fulfillment_profile text not null default 'boxnow_and_pickup',
  add column if not exists shipping_note_en text,
  add column if not exists shipping_note_gr text,
  add column if not exists shipping_note_zh text,
  add column if not exists package_weight_grams integer,
  add column if not exists package_length_mm integer,
  add column if not exists package_width_mm integer,
  add column if not exists package_height_mm integer;

alter table public.products
  drop constraint if exists products_fulfillment_profile_check,
  add constraint products_fulfillment_profile_check check (
    fulfillment_profile in ('boxnow_and_pickup', 'pickup_only')
  ),
  drop constraint if exists products_package_measurements_check,
  add constraint products_package_measurements_check check (
    (package_weight_grams is null or package_weight_grams > 0)
    and (package_length_mm is null or package_length_mm > 0)
    and (package_width_mm is null or package_width_mm > 0)
    and (package_height_mm is null or package_height_mm > 0)
  );

alter table public.product_variants
  add column if not exists fulfillment_profile_override text;

alter table public.product_variants
  drop constraint if exists product_variants_fulfillment_profile_override_check,
  add constraint product_variants_fulfillment_profile_override_check check (
    fulfillment_profile_override is null
    or fulfillment_profile_override in ('boxnow_and_pickup', 'pickup_only')
  );

-- Public storefronts may expose only the coarse fulfillment badge. Package
-- measurements and internal shipping notes remain service-role-only.
grant select (fulfillment_profile) on table public.products to anon, authenticated;

alter table public.online_orders
  add column if not exists fulfillment_status text not null default 'awaiting_payment',
  add column if not exists viva_order_code text,
  add column if not exists viva_transaction_id text,
  add column if not exists payment_expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists boxnow_locker_id text,
  add column if not exists boxnow_locker_name text,
  add column if not exists boxnow_locker_address text,
  add column if not exists boxnow_locker_postal_code text,
  add column if not exists pickup_code text,
  add column if not exists pickup_ready_at timestamptz,
  add column if not exists pickup_expires_at timestamptz,
  add column if not exists picked_up_at timestamptz;

alter table public.online_order_operations
  add column if not exists previous_status text,
  add column if not exists next_status text,
  add column if not exists note text;

alter table public.online_orders
  drop constraint if exists online_orders_status_check,
  add constraint online_orders_status_check check (
    status in (
      'pending', 'pending_payment', 'paid', 'confirmed', 'packing',
      'ready_for_pickup', 'shipped', 'completed', 'cancelled',
      'payment_failed', 'expired', 'refunded'
    )
  ),
  drop constraint if exists online_orders_fulfillment_check,
  add constraint online_orders_fulfillment_check check (
    fulfillment_method in ('delivery', 'pickup', 'box_now', 'store_pickup')
  ),
  drop constraint if exists online_orders_payment_method_check,
  add constraint online_orders_payment_method_check check (
    payment_method in ('cash_on_delivery', 'pay_at_pickup', 'viva')
  ),
  drop constraint if exists online_orders_payment_status_check,
  add constraint online_orders_payment_status_check check (
    payment_status in (
      'pending', 'payment_order_created', 'awaiting_confirmation', 'paid',
      'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded'
    )
  ),
  drop constraint if exists online_orders_fulfillment_status_check,
  add constraint online_orders_fulfillment_status_check check (
    fulfillment_status in (
      'awaiting_payment', 'paid', 'packing', 'ready_for_pickup',
      'shipment_pending', 'shipment_created', 'shipment_creation_failed',
      'ready_for_handover', 'in_transit', 'ready_at_locker', 'delivered',
      'returning', 'returned', 'exception', 'picked_up', 'completed', 'cancelled',
      'expired', 'pickup_overdue', 'reconciliation_required'
    )
  ),
  drop constraint if exists online_orders_delivery_address_check,
  add constraint online_orders_delivery_address_check check (
    fulfillment_method not in ('delivery')
    or (
      nullif(pg_catalog.btrim(coalesce(address_line1, '')), '') is not null
      and nullif(pg_catalog.btrim(coalesce(city, '')), '') is not null
      and nullif(pg_catalog.btrim(coalesce(postal_code, '')), '') is not null
    )
  ),
  drop constraint if exists online_orders_boxnow_locker_check,
  add constraint online_orders_boxnow_locker_check check (
    fulfillment_method <> 'box_now'
    or (
      nullif(pg_catalog.btrim(coalesce(boxnow_locker_id, '')), '') is not null
      and nullif(pg_catalog.btrim(coalesce(boxnow_locker_name, '')), '') is not null
    )
  ),
  drop constraint if exists online_orders_viva_identifiers_check,
  add constraint online_orders_viva_identifiers_check check (
    (viva_order_code is null or viva_order_code ~ '^[0-9]{1,64}$')
    and (viva_transaction_id is null or pg_catalog.length(viva_transaction_id) between 1 and 200)
  );

create unique index if not exists online_orders_viva_order_code_uidx
  on public.online_orders(viva_order_code)
  where viva_order_code is not null;
create unique index if not exists online_orders_viva_transaction_id_uidx
  on public.online_orders(viva_transaction_id)
  where viva_transaction_id is not null;
create index if not exists online_orders_fulfillment_status_idx
  on public.online_orders(fulfillment_status, created_at desc);

create table if not exists public.online_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique,
  order_id uuid not null references public.online_orders(id) on delete restrict,
  provider text not null default 'viva',
  status text not null default 'started',
  request_fingerprint text not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  provider_order_code text,
  provider_transaction_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_payment_attempts_provider_check check (provider = 'viva'),
  constraint online_payment_attempts_status_check check (
    status in ('started', 'payment_order_created', 'awaiting_confirmation', 'paid', 'failed', 'unknown', 'expired', 'cancelled')
  ),
  constraint online_payment_attempts_amount_check check (amount_cents >= 0),
  constraint online_payment_attempts_currency_check check (currency = 'EUR'),
  constraint online_payment_attempts_provider_order_code_check check (
    provider_order_code is null or provider_order_code ~ '^[0-9]{1,64}$'
  )
);

create unique index if not exists online_payment_attempts_provider_order_code_uidx
  on public.online_payment_attempts(provider, provider_order_code)
  where provider_order_code is not null;
create index if not exists online_payment_attempts_order_id_idx
  on public.online_payment_attempts(order_id, created_at desc);

create table if not exists public.online_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'viva',
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.online_orders(id) on delete restrict,
  provider_order_code text,
  provider_transaction_id text,
  amount_cents integer,
  currency text,
  status text not null default 'received',
  payload_digest text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_code text,
  constraint online_payment_events_provider_check check (provider = 'viva'),
  constraint online_payment_events_status_check check (
    status in ('received', 'processed', 'ignored', 'reconciliation_required')
  ),
  constraint online_payment_events_amount_check check (amount_cents is null or amount_cents >= 0),
  unique (provider, provider_event_id)
);

create index if not exists online_payment_events_order_id_idx
  on public.online_payment_events(order_id, received_at desc);
create index if not exists online_payment_events_provider_order_code_idx
  on public.online_payment_events(provider_order_code);

create table if not exists public.online_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.online_orders(id) on delete restrict,
  provider text not null default 'box_now',
  operation_id text not null unique,
  request_fingerprint text not null,
  status text not null default 'creating',
  locker_id text not null,
  parcel_id text,
  tracking_number text,
  label_reference text,
  failure_code text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_status text,
  last_synced_at timestamptz,
  cancelled_at timestamptz,
  constraint online_shipments_provider_check check (provider = 'box_now'),
  constraint online_shipments_status_check check (
    status in ('creating', 'created', 'label_ready', 'ready_for_handover', 'cancelling', 'in_transit', 'ready_at_locker', 'delivered', 'returning', 'returned', 'exception', 'failed', 'cancelled', 'reconciliation_required')
  )
);

create unique index if not exists online_shipments_parcel_id_uidx
  on public.online_shipments(parcel_id)
  where parcel_id is not null;
create unique index if not exists online_shipments_tracking_number_uidx
  on public.online_shipments(tracking_number)
  where tracking_number is not null;

create table if not exists public.product_fulfillment_operations (
  operation_id text primary key,
  product_id bigint not null references public.products(id) on delete restrict,
  request_fingerprint text not null,
  result jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);

alter table public.online_payment_attempts enable row level security;
alter table public.online_payment_events enable row level security;
alter table public.online_shipments enable row level security;
alter table public.product_fulfillment_operations enable row level security;

revoke all on table public.online_payment_attempts from anon, authenticated;
revoke all on table public.online_payment_events from anon, authenticated;
revoke all on table public.online_shipments from anon, authenticated;
revoke all on table public.product_fulfillment_operations from anon, authenticated;
grant select, insert, update, delete on table public.online_payment_attempts to service_role;
grant select, insert, update, delete on table public.online_payment_events to service_role;
grant select, insert, update, delete on table public.online_shipments to service_role;
grant select, insert, update, delete on table public.product_fulfillment_operations to service_role;

create or replace function public.product_fulfillment_update_rpc(
  p_product_id bigint,
  p_operation_id text,
  p_fulfillment_profile text,
  p_shipping_note_en text,
  p_shipping_note_gr text,
  p_shipping_note_zh text,
  p_package_weight_grams integer,
  p_package_length_mm integer,
  p_package_width_mm integer,
  p_package_height_mm integer,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_fingerprint text;
  v_existing public.product_fulfillment_operations%rowtype;
  v_result jsonb;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$' or p_fulfillment_profile not in ('boxnow_and_pickup','pickup_only')
     or nullif(pg_catalog.btrim(coalesce(p_actor,'')),'') is null
     or p_package_weight_grams is not null and p_package_weight_grams<=0
     or p_package_length_mm is not null and p_package_length_mm<=0
     or p_package_width_mm is not null and p_package_width_mm<=0
     or p_package_height_mm is not null and p_package_height_mm<=0 then
    raise exception using errcode='P0001',message='PRODUCT_FULFILLMENT_INVALID';
  end if;
  v_fingerprint:=pg_catalog.encode(pg_catalog.digest(pg_catalog.concat_ws('|',p_product_id,p_fulfillment_profile,
    coalesce(p_shipping_note_en,''),coalesce(p_shipping_note_gr,''),coalesce(p_shipping_note_zh,''),
    coalesce(p_package_weight_grams::text,''),coalesce(p_package_length_mm::text,''),coalesce(p_package_width_mm::text,''),coalesce(p_package_height_mm::text,'')),'sha256'),'hex');
  select * into v_existing from public.product_fulfillment_operations where operation_id=p_operation_id;
  if found then
    if v_existing.product_id<>p_product_id or v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='P0001',message='PRODUCT_FULFILLMENT_OPERATION_CONFLICT'; end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then raise exception using errcode='P0001',message='PRODUCT_NOT_FOUND'; end if;
  update public.products set fulfillment_profile=p_fulfillment_profile,
    shipping_note_en=nullif(pg_catalog.btrim(coalesce(p_shipping_note_en,'')),''),
    shipping_note_gr=nullif(pg_catalog.btrim(coalesce(p_shipping_note_gr,'')),''),
    shipping_note_zh=nullif(pg_catalog.btrim(coalesce(p_shipping_note_zh,'')),''),
    package_weight_grams=p_package_weight_grams,package_length_mm=p_package_length_mm,
    package_width_mm=p_package_width_mm,package_height_mm=p_package_height_mm,
    metadata_version=metadata_version+1,updated_at=pg_catalog.now()
  where id=p_product_id;
  select pg_catalog.jsonb_build_object('id',id,'sku',sku,'fulfillment_profile',fulfillment_profile,
    'shipping_note_en',shipping_note_en,'shipping_note_gr',shipping_note_gr,'shipping_note_zh',shipping_note_zh,
    'package_weight_grams',package_weight_grams,'package_length_mm',package_length_mm,
    'package_width_mm',package_width_mm,'package_height_mm',package_height_mm,'metadata_version',metadata_version)
  into v_result from public.products where id=p_product_id;
  insert into public.product_fulfillment_operations(operation_id,product_id,request_fingerprint,result,actor)
  values(p_operation_id,p_product_id,v_fingerprint,v_result,p_actor);
  return v_result||pg_catalog.jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.product_fulfillment_update_rpc(bigint,text,text,text,text,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.product_fulfillment_update_rpc(bigint,text,text,text,text,text,integer,integer,integer,integer,text) to service_role;

create or replace function public.online_checkout_prepare_rpc(
  p_operation_id text,
  p_request_fingerprint text,
  p_access_token_hash text,
  p_customer jsonb,
  p_items jsonb,
  p_fulfillment_method text,
  p_locker jsonb,
  p_boxnow_enabled boolean,
  p_pickup_enabled boolean,
  p_boxnow_minimum_subtotal numeric,
  p_boxnow_shipping_fee numeric,
  p_boxnow_free_shipping_threshold numeric,
  p_boxnow_max_items integer,
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
  v_customer jsonb := coalesce(p_customer, '{}'::jsonb);
  v_locker_id text := nullif(pg_catalog.btrim(coalesce(p_locker ->> 'id', '')), '');
  v_locker_name text := nullif(pg_catalog.btrim(coalesce(p_locker ->> 'name', '')), '');
  v_locker_address text := nullif(pg_catalog.btrim(coalesce(p_locker ->> 'address', '')), '');
  v_locker_postal_code text := nullif(pg_catalog.btrim(coalesce(p_locker ->> 'postalCode', '')), '');
  v_legacy_method text;
  v_legacy_payment text;
  v_result jsonb;
  v_order_id uuid;
  v_order public.online_orders%rowtype;
  v_item_count integer;
  v_boxnow_max_weight_grams integer;
  v_boxnow_max_length_mm integer;
  v_boxnow_max_width_mm integer;
  v_boxnow_max_height_mm integer;
  v_known_weight_grams bigint;
  v_dimensions_exceeded boolean;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_ITEMS';
  end if;
  if p_fulfillment_method not in ('box_now', 'store_pickup') then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_FULFILLMENT';
  end if;
  if p_fulfillment_method = 'box_now' and not coalesce(p_boxnow_enabled, false) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_FULFILLMENT_DISABLED';
  end if;
  if p_fulfillment_method = 'store_pickup' and not coalesce(p_pickup_enabled, false) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_FULFILLMENT_DISABLED';
  end if;
  if p_fulfillment_method = 'box_now' and (v_locker_id is null or v_locker_name is null) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_LOCKER_REQUIRED';
  end if;
  if p_boxnow_max_items < 1 or p_boxnow_max_items > 100 then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_CONFIGURATION';
  end if;

  if p_fulfillment_method = 'box_now' then
    select boxnow_max_weight_grams, boxnow_max_length_mm, boxnow_max_width_mm, boxnow_max_height_mm
      into v_boxnow_max_weight_grams, v_boxnow_max_length_mm, v_boxnow_max_width_mm, v_boxnow_max_height_mm
    from public.business_settings
    order by created_at
    limit 1;
    if v_boxnow_max_weight_grams is null or v_boxnow_max_weight_grams < 1
       or v_boxnow_max_length_mm is null or v_boxnow_max_length_mm < 1
       or v_boxnow_max_width_mm is null or v_boxnow_max_width_mm < 1
       or v_boxnow_max_height_mm is null or v_boxnow_max_height_mm < 1 then
      raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_INVALID_CONFIGURATION';
    end if;
  end if;

  select coalesce(pg_catalog.sum((item ->> 'quantity')::integer), 0)::integer
    into v_item_count
  from pg_catalog.jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item;
  if v_item_count < 1 or (p_fulfillment_method='box_now' and v_item_count > p_boxnow_max_items) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_PACKAGE_LIMIT';
  end if;

  if p_fulfillment_method = 'box_now' then
    v_legacy_method := 'delivery';
    v_legacy_payment := 'cash_on_delivery';
    v_customer := v_customer || pg_catalog.jsonb_build_object(
      'addressLine1', coalesce(v_locker_address, v_locker_name),
      'city', 'BOX NOW Locker',
      'postalCode', coalesce(v_locker_postal_code, '00000')
    );
  else
    v_legacy_method := 'pickup';
    v_legacy_payment := 'pay_at_pickup';
  end if;

  v_result := public.online_order_create_rpc(
    p_operation_id,
    p_request_fingerprint,
    p_access_token_hash,
    v_customer,
    p_items,
    v_legacy_method,
    v_legacy_payment,
    case when p_fulfillment_method = 'box_now' then p_boxnow_shipping_fee else 0 end,
    case when p_fulfillment_method = 'box_now' then p_boxnow_free_shipping_threshold else null end,
    p_locale,
    p_legal_terms_version,
    p_privacy_policy_version,
    p_legal_accepted_at
  );

  v_order_id := nullif(v_result ->> 'id', '')::uuid;
  if v_order_id is null then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_RESULT_UNKNOWN';
  end if;
  select * into v_order from public.online_orders where id = v_order_id for update;

  -- A response-loss retry may arrive after Viva has already confirmed payment.
  -- Never regress a committed checkout back to pending state.
  if coalesce((v_result ->> 'replayed')::boolean, false)
     and v_order.fulfillment_method in ('box_now','store_pickup') then
    if v_order.fulfillment_method<>p_fulfillment_method
       or (p_fulfillment_method='box_now' and v_order.boxnow_locker_id is distinct from v_locker_id) then
      raise exception using errcode='P0001',message='ONLINE_ORDER_IDEMPOTENCY_CONFLICT';
    end if;
    return app_private.online_order_payload(v_order_id,true)
      || pg_catalog.jsonb_build_object(
        'amountCents',pg_catalog.round(v_order.total*100)::integer,
        'locker',case when v_order.fulfillment_method='box_now' then pg_catalog.jsonb_build_object(
          'id',v_order.boxnow_locker_id,'name',v_order.boxnow_locker_name,
          'address',v_order.boxnow_locker_address,'postalCode',v_order.boxnow_locker_postal_code
        ) else null end
      );
  end if;

  if p_fulfillment_method = 'box_now' and v_order.subtotal < greatest(coalesce(p_boxnow_minimum_subtotal, 0), 0) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_BOXNOW_MINIMUM_NOT_MET';
  end if;
  if p_fulfillment_method = 'box_now' and exists (
    select 1
    from public.online_order_items i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = i.product_id
    where i.order_id = v_order_id
      and coalesce(v.fulfillment_profile_override, p.fulfillment_profile, 'boxnow_and_pickup') = 'pickup_only'
  ) then
    raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_PICKUP_ONLY_ITEM';
  end if;
  if p_fulfillment_method = 'box_now' then
    select
      coalesce(pg_catalog.sum(coalesce(p.package_weight_grams, 0)::bigint * i.quantity), 0),
      coalesce(pg_catalog.bool_or(
        (p.package_length_mm is not null and p.package_length_mm > v_boxnow_max_length_mm)
        or (p.package_width_mm is not null and p.package_width_mm > v_boxnow_max_width_mm)
        or (p.package_height_mm is not null and p.package_height_mm > v_boxnow_max_height_mm)
      ), false)
      into v_known_weight_grams, v_dimensions_exceeded
    from public.online_order_items i
    join public.products p on p.id = i.product_id
    where i.order_id = v_order_id;
    if v_known_weight_grams > v_boxnow_max_weight_grams or v_dimensions_exceeded then
      raise exception using errcode = 'P0001', message = 'ONLINE_ORDER_PACKAGE_LIMIT';
    end if;
  end if;

  update public.online_orders
  set status = 'pending_payment',
      fulfillment_method = p_fulfillment_method,
      payment_method = 'viva',
      payment_status = 'pending',
      fulfillment_status = 'awaiting_payment',
      address_line1 = null,
      city = null,
      postal_code = null,
      boxnow_locker_id = case when p_fulfillment_method = 'box_now' then v_locker_id else null end,
      boxnow_locker_name = case when p_fulfillment_method = 'box_now' then v_locker_name else null end,
      boxnow_locker_address = case when p_fulfillment_method = 'box_now' then v_locker_address else null end,
      boxnow_locker_postal_code = case when p_fulfillment_method = 'box_now' then v_locker_postal_code else null end,
      updated_at = pg_catalog.now()
  where id = v_order_id
  returning * into v_order;

  insert into public.online_payment_attempts(
    operation_id, order_id, request_fingerprint, amount_cents, currency
  ) values (
    p_operation_id,
    v_order_id,
    p_request_fingerprint,
    pg_catalog.round(v_order.total * 100)::integer,
    'EUR'
  ) on conflict (operation_id) do nothing;

  return app_private.online_order_payload(v_order_id, coalesce((v_result ->> 'replayed')::boolean, false))
    || pg_catalog.jsonb_build_object(
      'amountCents', pg_catalog.round(v_order.total * 100)::integer,
      'locker', case when p_fulfillment_method = 'box_now' then pg_catalog.jsonb_build_object(
        'id', v_locker_id,
        'name', v_locker_name,
        'address', v_locker_address,
        'postalCode', v_locker_postal_code
      ) else null end
    );
end;
$$;

revoke all on function public.online_checkout_prepare_rpc(
  text,text,text,jsonb,jsonb,text,jsonb,boolean,boolean,numeric,numeric,numeric,integer,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.online_checkout_prepare_rpc(
  text,text,text,jsonb,jsonb,text,jsonb,boolean,boolean,numeric,numeric,numeric,integer,text,text,text,timestamptz
) to service_role;

-- The legacy COD/pay-at-pickup creation RPC remains as an internal building
-- block for the transactional wrapper, but is no longer a callable runtime
-- entry point.
revoke execute on function public.online_order_create_rpc(text,text,text,jsonb,jsonb,text,text,numeric,numeric,text,text,text,timestamptz)
from service_role;

create or replace function public.online_checkout_bind_viva_rpc(
  p_operation_id text,
  p_request_fingerprint text,
  p_order_id uuid,
  p_viva_order_code text,
  p_payment_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.online_payment_attempts%rowtype;
  v_order public.online_orders%rowtype;
begin
  if p_viva_order_code !~ '^[0-9]{1,64}$' then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_INVALID_ORDER_CODE';
  end if;
  select * into v_attempt
  from public.online_payment_attempts
  where operation_id = p_operation_id
  for update;
  if not found or v_attempt.order_id <> p_order_id or v_attempt.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_ATTEMPT_CONFLICT';
  end if;
  if v_attempt.provider_order_code is not null and v_attempt.provider_order_code <> p_viva_order_code then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_ATTEMPT_CONFLICT';
  end if;
  select * into v_order from public.online_orders where id = p_order_id for update;
  if not found or (v_order.viva_order_code is not null and v_order.viva_order_code <> p_viva_order_code) then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_ATTEMPT_CONFLICT';
  end if;

  update public.online_payment_attempts
  set status = 'payment_order_created', provider_order_code = p_viva_order_code, updated_at = pg_catalog.now()
  where id = v_attempt.id;
  update public.online_orders
  set viva_order_code = p_viva_order_code,
      payment_status = 'payment_order_created',
      payment_expires_at = p_payment_expires_at,
      updated_at = pg_catalog.now()
  where id = p_order_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'orderNumber', v_order.order_number,
    'vivaOrderCode', p_viva_order_code,
    'replayed', v_attempt.provider_order_code is not null
  );
end;
$$;

revoke all on function public.online_checkout_bind_viva_rpc(text,text,uuid,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.online_checkout_bind_viva_rpc(text,text,uuid,text,timestamptz)
to service_role;

create or replace function public.online_payment_confirm_rpc(
  p_provider_event_id text,
  p_event_type text,
  p_provider_order_code text,
  p_provider_transaction_id text,
  p_amount_cents integer,
  p_currency text,
  p_payload_digest text,
  p_confirmed_success boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.online_payment_events%rowtype;
  v_order public.online_orders%rowtype;
  v_expected_cents integer;
  v_pickup_code text;
begin
  if nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_event_type, '')), '') is null
     or p_provider_order_code !~ '^[0-9]{1,64}$'
     or nullif(pg_catalog.btrim(coalesce(p_provider_transaction_id, '')), '') is null
     or p_amount_cents < 0
     or p_currency <> 'EUR'
     or p_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_EVENT_INVALID';
  end if;

  select * into v_existing
  from public.online_payment_events
  where provider = 'viva' and provider_event_id = p_provider_event_id;
  if found then
    if v_existing.payload_digest<>p_payload_digest
       or v_existing.provider_order_code is distinct from p_provider_order_code
       or v_existing.provider_transaction_id is distinct from p_provider_transaction_id then
      raise exception using errcode='P0001',message='ONLINE_PAYMENT_EVENT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'status', v_existing.status,
      'orderId', v_existing.order_id
    );
  end if;

  select * into v_order
  from public.online_orders
  where viva_order_code = p_provider_order_code
  for update;
  if not found then
    insert into public.online_payment_events(
      provider_event_id,event_type,provider_order_code,provider_transaction_id,
      amount_cents,currency,status,payload_digest,failure_code
    ) values (
      p_provider_event_id,p_event_type,p_provider_order_code,p_provider_transaction_id,
      p_amount_cents,p_currency,'reconciliation_required',p_payload_digest,'ORDER_NOT_FOUND'
    );
    return pg_catalog.jsonb_build_object('ok', false, 'reconciliationRequired', true, 'code', 'ORDER_NOT_FOUND');
  end if;

  v_expected_cents := pg_catalog.round(v_order.total * 100)::integer;
  if not p_confirmed_success or p_amount_cents <> v_expected_cents or p_currency <> v_order.currency then
    insert into public.online_payment_events(
      provider_event_id,event_type,order_id,provider_order_code,provider_transaction_id,
      amount_cents,currency,status,payload_digest,failure_code
    ) values (
      p_provider_event_id,p_event_type,v_order.id,p_provider_order_code,p_provider_transaction_id,
      p_amount_cents,p_currency,'reconciliation_required',p_payload_digest,
      case when not p_confirmed_success then 'PROVIDER_NOT_CONFIRMED' else 'AMOUNT_OR_CURRENCY_MISMATCH' end
    );
    update public.online_orders
    set payment_status = case when p_confirmed_success then 'failed' else payment_status end,
        fulfillment_status = 'reconciliation_required',
        updated_at = pg_catalog.now()
    where id = v_order.id;
    return pg_catalog.jsonb_build_object('ok', false, 'reconciliationRequired', true, 'orderId', v_order.id);
  end if;

  if v_order.viva_transaction_id is not null and v_order.viva_transaction_id <> p_provider_transaction_id then
    raise exception using errcode = 'P0001', message = 'ONLINE_PAYMENT_TRANSACTION_CONFLICT';
  end if;

  if exists(
    select 1
    from public.online_order_items i
    join public.inventory_locations l on l.code='MAIN_STORE' and l.active
    left join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
    where i.order_id=v_order.id and coalesce(b.quantity_reserved,0)<i.quantity
  ) then
    insert into public.online_payment_events(
      provider_event_id,event_type,order_id,provider_order_code,provider_transaction_id,
      amount_cents,currency,status,payload_digest,processed_at,failure_code
    ) values (
      p_provider_event_id,p_event_type,v_order.id,p_provider_order_code,p_provider_transaction_id,
      p_amount_cents,p_currency,'reconciliation_required',p_payload_digest,pg_catalog.now(),'INSUFFICIENT_RESERVED_STOCK'
    );
    update public.online_payment_attempts
    set status='paid',provider_transaction_id=p_provider_transaction_id,updated_at=pg_catalog.now()
    where order_id=v_order.id and provider_order_code=p_provider_order_code;
    update public.online_orders
    set status='paid',payment_status='paid',fulfillment_status='reconciliation_required',
        viva_transaction_id=p_provider_transaction_id,paid_at=coalesce(paid_at,pg_catalog.now()),updated_at=pg_catalog.now()
    where id=v_order.id;
    return pg_catalog.jsonb_build_object('ok',false,'reconciliationRequired',true,'orderId',v_order.id,'code','INSUFFICIENT_RESERVED_STOCK');
  end if;
  if v_order.fulfillment_method = 'store_pickup' then
    v_pickup_code := coalesce(v_order.pickup_code, pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8)));
  end if;

  insert into public.online_payment_events(
    provider_event_id,event_type,order_id,provider_order_code,provider_transaction_id,
    amount_cents,currency,status,payload_digest,processed_at
  ) values (
    p_provider_event_id,p_event_type,v_order.id,p_provider_order_code,p_provider_transaction_id,
    p_amount_cents,p_currency,'processed',p_payload_digest,pg_catalog.now()
  );
  update public.online_payment_attempts
  set status = 'paid', provider_transaction_id = p_provider_transaction_id, updated_at = pg_catalog.now()
  where order_id = v_order.id and provider_order_code = p_provider_order_code;
  update public.online_orders
  set status = 'paid',
      payment_status = 'paid',
      fulfillment_status = case when fulfillment_method = 'box_now' then 'shipment_pending' else 'paid' end,
      viva_transaction_id = p_provider_transaction_id,
      paid_at = coalesce(paid_at, pg_catalog.now()),
      pickup_code = v_pickup_code,
      updated_at = pg_catalog.now()
  where id = v_order.id;

  return pg_catalog.jsonb_build_object('ok', true, 'replayed', false, 'orderId', v_order.id, 'paymentStatus', 'paid');
end;
$$;

revoke all on function public.online_payment_confirm_rpc(text,text,text,text,integer,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.online_payment_confirm_rpc(text,text,text,text,integer,text,text,boolean)
to service_role;

comment on column public.online_orders.viva_order_code is
  'Viva orderCode is an opaque decimal string and must never be coerced to JavaScript Number.';
comment on column public.products.fulfillment_profile is
  'Default online fulfillment profile. Variant override wins when present.';
comment on table public.online_payment_events is
  'Private, digest-only Viva webhook receipt ledger. Raw provider payloads are intentionally not persisted.';

create or replace function public.online_shipment_prepare_rpc(
  p_order_id uuid,
  p_operation_id text,
  p_request_fingerprint text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.online_orders%rowtype;
  v_shipment public.online_shipments%rowtype;
  v_items jsonb;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$'
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or nullif(pg_catalog.btrim(coalesce(p_actor, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'ONLINE_SHIPMENT_INVALID_OPERATION';
  end if;
  select * into v_order from public.online_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_ORDER_NOT_FOUND'; end if;
  if v_order.payment_status <> 'paid' or v_order.fulfillment_method <> 'box_now'
     or v_order.boxnow_locker_id is null then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_NOT_ELIGIBLE';
  end if;

  select * into v_shipment from public.online_shipments where order_id=p_order_id for update;
  if found then
    if v_shipment.status in ('creating','reconciliation_required') then
      return pg_catalog.jsonb_build_object('ok',false,'reconciliationRequired',true,'shipmentId',v_shipment.id,'status',v_shipment.status);
    end if;
    if v_shipment.status in ('created','label_ready','ready_for_handover','in_transit','ready_at_locker','delivered','returning','returned') then
      return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'shipmentId',v_shipment.id,'status',v_shipment.status,'parcelId',v_shipment.parcel_id,'referenceNumber',v_shipment.tracking_number);
    end if;
    update public.online_shipments
    set operation_id=p_operation_id,request_fingerprint=p_request_fingerprint,status='creating',
        failure_code=null,created_by=p_actor,updated_at=pg_catalog.now()
    where id=v_shipment.id returning * into v_shipment;
  else
    insert into public.online_shipments(order_id,operation_id,request_fingerprint,locker_id,created_by)
    values(p_order_id,p_operation_id,p_request_fingerprint,v_order.boxnow_locker_id,p_actor)
    returning * into v_shipment;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', i.id,
    'name', coalesce(nullif(i.name_gr,''),nullif(i.name_en,''),i.product_sku),
    'valueCents', pg_catalog.round(i.line_total*100)::integer,
    'quantity', i.quantity
  ) order by i.id),'[]'::jsonb) into v_items
  from public.online_order_items i where i.order_id=p_order_id;

  return pg_catalog.jsonb_build_object(
    'ok',true,'replayed',false,'shipmentId',v_shipment.id,'orderId',v_order.id,
    'orderNumber',v_order.order_number,'totalCents',pg_catalog.round(v_order.total*100)::integer,
    'customer',pg_catalog.jsonb_build_object('name',v_order.customer_name,'email',v_order.customer_email,'phone',v_order.customer_phone),
    'lockerId',v_order.boxnow_locker_id,'items',v_items
  );
end;
$$;

revoke all on function public.online_shipment_prepare_rpc(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.online_shipment_prepare_rpc(uuid,text,text,text) to service_role;

create or replace function public.online_shipment_complete_rpc(
  p_shipment_id uuid,
  p_operation_id text,
  p_reference_number text,
  p_parcel_id text,
  p_failure_code text,
  p_outcome_unknown boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_shipment public.online_shipments%rowtype;
begin
  select * into v_shipment from public.online_shipments where id=p_shipment_id for update;
  if not found or v_shipment.operation_id<>p_operation_id then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_OPERATION_CONFLICT';
  end if;
  if v_shipment.status in ('created','label_ready','in_transit','delivered') then
    if v_shipment.parcel_id<>p_parcel_id or v_shipment.tracking_number<>p_reference_number then
      raise exception using errcode='P0001',message='ONLINE_SHIPMENT_OPERATION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('ok',true,'replayed',true,'shipmentId',v_shipment.id,'parcelId',v_shipment.parcel_id,'referenceNumber',v_shipment.tracking_number);
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_reference_number,'')),'') is not null
     and nullif(pg_catalog.btrim(coalesce(p_parcel_id,'')),'') is not null then
    update public.online_shipments set status='created',tracking_number=p_reference_number,
      parcel_id=p_parcel_id,failure_code=null,updated_at=pg_catalog.now() where id=v_shipment.id;
    update public.online_orders set status='packing',fulfillment_status='shipment_created',updated_at=pg_catalog.now() where id=v_shipment.order_id;
    return pg_catalog.jsonb_build_object('ok',true,'replayed',false,'shipmentId',v_shipment.id,'parcelId',p_parcel_id,'referenceNumber',p_reference_number);
  end if;
  update public.online_shipments set status=case when p_outcome_unknown then 'reconciliation_required' else 'failed' end,
    failure_code=left(coalesce(p_failure_code,'BOXNOW_CREATE_FAILED'),120),updated_at=pg_catalog.now() where id=v_shipment.id;
  update public.online_orders set fulfillment_status=case when p_outcome_unknown then 'reconciliation_required' else 'shipment_creation_failed' end,
    updated_at=pg_catalog.now() where id=v_shipment.order_id;
  return pg_catalog.jsonb_build_object('ok',false,'reconciliationRequired',p_outcome_unknown,'shipmentId',v_shipment.id);
end;
$$;

revoke all on function public.online_shipment_complete_rpc(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.online_shipment_complete_rpc(uuid,text,text,text,text,boolean) to service_role;

create or replace function public.online_shipment_cancel_prepare_rpc(
  p_order_id uuid,p_operation_id text,p_request_fingerprint text,p_actor text,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.online_orders%rowtype;
  v_shipment public.online_shipments%rowtype;
  v_existing public.online_order_operations%rowtype;
  v_result jsonb;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$'
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or nullif(pg_catalog.btrim(coalesce(p_actor,'')),'') is null then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_INVALID_OPERATION';
  end if;
  select * into v_existing from public.online_order_operations where operation_id=p_operation_id;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.action<>'boxnow_cancel'
       or v_existing.request_fingerprint<>p_request_fingerprint then
      raise exception using errcode='P0001',message='ONLINE_SHIPMENT_OPERATION_CONFLICT';
    end if;
    if coalesce((v_existing.result->>'pending')::boolean,false) then
      return v_existing.result||pg_catalog.jsonb_build_object('replayed',true,'reconciliationRequired',true);
    end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;
  select * into v_order from public.online_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_ORDER_NOT_FOUND'; end if;
  select * into v_shipment from public.online_shipments where order_id=p_order_id for update;
  if not found or v_order.fulfillment_method<>'box_now' or v_shipment.parcel_id is null then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_NOT_FOUND';
  end if;
  if v_shipment.status='cancelled' then
    v_result:=pg_catalog.jsonb_build_object('ok',true,'status','cancelled','shipmentId',v_shipment.id,'replayed',true);
    insert into public.online_order_operations(operation_id,order_id,action,request_fingerprint,result,actor,previous_status,next_status,note)
    values(p_operation_id,p_order_id,'boxnow_cancel',p_request_fingerprint,v_result,p_actor,'cancelled','cancelled',pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note,'')),''),500));
    return v_result;
  end if;
  if v_shipment.status in ('cancelling','reconciliation_required') then
    return pg_catalog.jsonb_build_object('ok',false,'reconciliationRequired',true,'shipmentId',v_shipment.id,'status',v_shipment.status);
  end if;
  if v_shipment.status not in ('created','label_ready','ready_for_handover') or v_order.status<>'packing' then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_CANCEL_NOT_ALLOWED';
  end if;
  v_result:=pg_catalog.jsonb_build_object('ok',false,'pending',true,'shipmentId',v_shipment.id,'parcelId',v_shipment.parcel_id,'status','cancelling');
  insert into public.online_order_operations(operation_id,order_id,action,request_fingerprint,result,actor,previous_status,next_status,note)
  values(p_operation_id,p_order_id,'boxnow_cancel',p_request_fingerprint,v_result,p_actor,v_shipment.status,'cancelling',pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note,'')),''),500));
  update public.online_shipments set status='cancelling',failure_code=null,updated_at=pg_catalog.now() where id=v_shipment.id;
  return v_result;
end;
$$;

revoke all on function public.online_shipment_cancel_prepare_rpc(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.online_shipment_cancel_prepare_rpc(uuid,text,text,text,text) to service_role;

create or replace function public.online_shipment_cancel_complete_rpc(
  p_order_id uuid,p_operation_id text,p_cancelled boolean,p_failure_code text,p_outcome_unknown boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operation public.online_order_operations%rowtype;
  v_shipment public.online_shipments%rowtype;
  v_result jsonb;
  v_restore_status text;
begin
  select * into v_operation from public.online_order_operations where operation_id=p_operation_id for update;
  if not found or v_operation.order_id<>p_order_id or v_operation.action<>'boxnow_cancel' then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_OPERATION_CONFLICT';
  end if;
  select * into v_shipment from public.online_shipments where order_id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status='cancelled' then
    return v_operation.result||pg_catalog.jsonb_build_object('ok',true,'replayed',true,'status','cancelled');
  end if;
  if p_cancelled then
    update public.online_shipments set status='cancelled',failure_code=null,cancelled_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_shipment.id;
    update public.online_orders set status='packing',fulfillment_status='shipment_pending',updated_at=pg_catalog.now() where id=p_order_id;
    v_result:=pg_catalog.jsonb_build_object('ok',true,'status','cancelled','shipmentId',v_shipment.id,'replayed',false);
  elsif p_outcome_unknown then
    update public.online_shipments set status='reconciliation_required',failure_code=pg_catalog.left(coalesce(p_failure_code,'BOXNOW_CANCEL_UNKNOWN'),120),updated_at=pg_catalog.now() where id=v_shipment.id;
    update public.online_orders set fulfillment_status='reconciliation_required',updated_at=pg_catalog.now() where id=p_order_id;
    v_result:=pg_catalog.jsonb_build_object('ok',false,'status','reconciliation_required','reconciliationRequired',true,'shipmentId',v_shipment.id);
  else
    v_restore_status:=case when v_operation.previous_status in ('created','label_ready','ready_for_handover') then v_operation.previous_status else 'created' end;
    update public.online_shipments set status=v_restore_status,failure_code=pg_catalog.left(coalesce(p_failure_code,'BOXNOW_CANCEL_REJECTED'),120),updated_at=pg_catalog.now() where id=v_shipment.id;
    update public.online_orders set fulfillment_status='shipment_created',updated_at=pg_catalog.now() where id=p_order_id;
    v_result:=pg_catalog.jsonb_build_object('ok',false,'status',v_restore_status,'reconciliationRequired',false,'shipmentId',v_shipment.id);
  end if;
  update public.online_order_operations set result=v_result,next_status=v_result->>'status' where operation_id=p_operation_id;
  return v_result;
end;
$$;

revoke all on function public.online_shipment_cancel_complete_rpc(uuid,text,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.online_shipment_cancel_complete_rpc(uuid,text,boolean,text,boolean) to service_role;

create or replace function public.online_shipment_refresh_rpc(
  p_order_id uuid,p_operation_id text,p_actor text,p_provider_state text,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.online_orders%rowtype;
  v_shipment public.online_shipments%rowtype;
  v_existing public.online_order_operations%rowtype;
  v_next text;
  v_result jsonb;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$' or nullif(pg_catalog.btrim(coalesce(p_actor,'')),'') is null
     or p_provider_state not in ('new','wait-for-load','in-transit','in-depot','in-final-destination','delivered','expired-return','accepted-for-return','returned','cancelled','lost','missing') then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_INVALID_OPERATION';
  end if;
  select * into v_existing from public.online_order_operations where operation_id=p_operation_id;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.action<>'boxnow_refresh' or v_existing.request_fingerprint<>p_provider_state then
      raise exception using errcode='P0001',message='ONLINE_SHIPMENT_OPERATION_CONFLICT';
    end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;
  select * into v_order from public.online_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_ORDER_NOT_FOUND'; end if;
  select * into v_shipment from public.online_shipments where order_id=p_order_id for update;
  if not found or v_order.fulfillment_method<>'box_now' or v_shipment.parcel_id is null then
    raise exception using errcode='P0001',message='ONLINE_SHIPMENT_NOT_FOUND';
  end if;
  v_next:=case
    when p_provider_state in ('new','wait-for-load') then 'ready_for_handover'
    when p_provider_state in ('in-transit','in-depot') then 'in_transit'
    when p_provider_state='in-final-destination' then 'ready_at_locker'
    when p_provider_state='delivered' then 'delivered'
    when p_provider_state in ('expired-return','accepted-for-return') then 'returning'
    when p_provider_state='returned' then 'returned'
    when p_provider_state='cancelled' then 'cancelled'
    else 'exception'
  end;
  if (v_shipment.status='delivered' and v_next in ('ready_for_handover','in_transit','ready_at_locker'))
     or (v_shipment.status='returned' and v_next<>'returned')
     or (v_shipment.status='cancelled' and v_next<>'cancelled') then
    v_next:=v_shipment.status;
  end if;
  update public.online_shipments
  set status=v_next,provider_status=p_provider_state,last_synced_at=pg_catalog.now(),
      failure_code=case when v_next='exception' then 'BOXNOW_PROVIDER_EXCEPTION' else null end,
      cancelled_at=case when v_next='cancelled' then coalesce(cancelled_at,pg_catalog.now()) else cancelled_at end,
      updated_at=pg_catalog.now()
  where id=v_shipment.id;
  if v_next='ready_for_handover' then
    update public.online_orders set status='packing',fulfillment_status='ready_for_handover',updated_at=pg_catalog.now() where id=p_order_id and status not in ('completed','cancelled');
  elsif v_next in ('in_transit','ready_at_locker','delivered','returning','returned','exception') then
    update public.online_orders set status=case when status in ('completed','cancelled') then status else 'shipped' end,
      fulfillment_status=v_next,shipped_at=coalesce(shipped_at,pg_catalog.now()),updated_at=pg_catalog.now() where id=p_order_id;
  elsif v_next='cancelled' and v_order.status='packing' then
    update public.online_orders set fulfillment_status='shipment_pending',updated_at=pg_catalog.now() where id=p_order_id;
  elsif v_next='cancelled' then
    update public.online_orders set fulfillment_status='reconciliation_required',updated_at=pg_catalog.now() where id=p_order_id;
  end if;
  v_result:=pg_catalog.jsonb_build_object('ok',true,'shipmentId',v_shipment.id,'providerState',p_provider_state,'status',v_next,'replayed',false);
  insert into public.online_order_operations(operation_id,order_id,action,request_fingerprint,result,actor,previous_status,next_status,note)
  values(p_operation_id,p_order_id,'boxnow_refresh',p_provider_state,v_result,p_actor,v_shipment.status,v_next,pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note,'')),''),500));
  return v_result;
end;
$$;

revoke all on function public.online_shipment_refresh_rpc(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.online_shipment_refresh_rpc(uuid,text,text,text,text) to service_role;

drop function if exists public.online_order_transition_rpc(uuid,text,text,text);

create or replace function public.online_order_transition_rpc(
  p_order_id uuid,p_target_status text,p_operation_id text,p_actor text,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.online_orders%rowtype;
  v_existing public.online_order_operations%rowtype;
  v_row record;
  v_result jsonb;
  v_hold_days integer;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$' or nullif(pg_catalog.btrim(coalesce(p_actor,'')),'') is null then
    raise exception using errcode='P0001',message='ONLINE_ORDER_INVALID_OPERATION';
  end if;
  select * into v_existing from public.online_order_operations where operation_id=p_operation_id;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.action<>p_target_status then raise exception using errcode='P0001',message='ONLINE_ORDER_OPERATION_CONFLICT'; end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;
  select * into v_order from public.online_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_ORDER_NOT_FOUND'; end if;
  if v_order.status=p_target_status then return app_private.online_order_payload(v_order.id,true); end if;
  select pickup_hold_days into v_hold_days from public.business_settings order by created_at limit 1;
  v_hold_days:=greatest(coalesce(v_hold_days,3),1);

  if p_target_status='packing' and v_order.status='paid' and v_order.payment_status='paid' then
    update public.online_orders set status='packing',fulfillment_status='packing',updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status='ready_for_pickup' and v_order.status in ('paid','packing') and v_order.payment_status='paid' and v_order.fulfillment_method='store_pickup' then
    update public.online_orders set status='ready_for_pickup',fulfillment_status='ready_for_pickup',
      ready_at=pg_catalog.now(),pickup_ready_at=pg_catalog.now(),pickup_expires_at=pg_catalog.now()+pg_catalog.make_interval(days=>v_hold_days),updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status='shipped' and v_order.status='packing' and v_order.payment_status='paid' and v_order.fulfillment_method='box_now'
    and exists(select 1 from public.online_shipments s where s.order_id=v_order.id and s.status in ('created','label_ready','ready_for_handover')) then
    update public.online_orders set status='shipped',fulfillment_status='in_transit',shipped_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_order.id;
    update public.online_shipments set status='in_transit',updated_at=pg_catalog.now() where order_id=v_order.id;
  elsif p_target_status='cancelled' and v_order.payment_status in ('pending','payment_order_created','awaiting_confirmation','failed','expired') and v_order.status in ('pending','pending_payment','payment_failed','expired') then
    for v_row in select i.variant_id,i.quantity,b.id balance_id,b.quantity_on_hand,b.quantity_reserved,l.id location_id
      from public.online_order_items i join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id order by i.variant_id for update of b
    loop
      if v_row.quantity_reserved<v_row.quantity then raise exception using errcode='P0001',message='ONLINE_ORDER_RECONCILIATION_REQUIRED'; end if;
      update public.inventory_balances set quantity_reserved=quantity_reserved-v_row.quantity,updated_at=pg_catalog.now() where id=v_row.balance_id;
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by)
      values(v_row.variant_id,v_row.location_id,'release_reservation',0,v_row.quantity_on_hand,v_row.quantity_on_hand,'Online payment order cancelled','online_order',v_order.id::text,p_operation_id||':'||v_row.variant_id::text||':release',p_actor);
    end loop;
    update public.online_orders set status='cancelled',payment_status='cancelled',fulfillment_status='cancelled',cancelled_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_order.id;
  elsif p_target_status='completed' and v_order.payment_status='paid'
    and ((v_order.status='ready_for_pickup' and v_order.fulfillment_method='store_pickup')
      or (v_order.status='shipped' and v_order.fulfillment_method='box_now' and v_order.fulfillment_status in ('in_transit','ready_at_locker','delivered'))) then
    for v_row in select i.product_id,i.variant_id,i.quantity,b.id balance_id,b.quantity_on_hand,b.quantity_reserved,l.id location_id
      from public.online_order_items i join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id order by i.variant_id for update of b
    loop
      if v_row.quantity_reserved<v_row.quantity or v_row.quantity_on_hand<v_row.quantity then raise exception using errcode='P0001',message='ONLINE_ORDER_RECONCILIATION_REQUIRED'; end if;
      update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_row.quantity,quantity_reserved=quantity_reserved-v_row.quantity,updated_at=pg_catalog.now() where id=v_row.balance_id;
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by)
      values(v_row.variant_id,v_row.location_id,'sale',0-v_row.quantity,v_row.quantity_on_hand,v_row.quantity_on_hand-v_row.quantity,'Online prepaid order completed','online_order',v_order.id::text,p_operation_id||':'||v_row.variant_id::text||':sale',p_actor);
      update public.products set stock=stock,sizes=sizes,size_stock=size_stock where id=v_row.product_id;
    end loop;
    update public.online_orders set status='completed',fulfillment_status=case when fulfillment_method='store_pickup' then 'picked_up' else 'delivered' end,
      picked_up_at=case when fulfillment_method='store_pickup' then pg_catalog.now() else picked_up_at end,completed_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=v_order.id;
  else
    raise exception using errcode='P0001',message='ONLINE_ORDER_INVALID_TRANSITION';
  end if;
  v_result:=app_private.online_order_payload(v_order.id,false);
  insert into public.online_order_operations(
    operation_id,order_id,action,request_fingerprint,result,actor,
    previous_status,next_status,note
  ) values(
    p_operation_id,v_order.id,p_target_status,p_target_status,v_result,p_actor,
    v_order.status,p_target_status,pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note,'')),''),500)
  );
  return v_result;
end;
$$;

revoke all on function public.online_order_transition_rpc(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.online_order_transition_rpc(uuid,text,text,text,text) to service_role;

create or replace function public.online_order_extend_pickup_rpc(
  p_order_id uuid,p_operation_id text,p_actor text,p_days integer,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.online_orders%rowtype;
  v_existing public.online_order_operations%rowtype;
  v_result jsonb;
begin
  if p_operation_id !~ '^[0-9a-f-]{36}$'
     or nullif(pg_catalog.btrim(coalesce(p_actor,'')),'') is null
     or p_days<1 or p_days>30 then
    raise exception using errcode='P0001',message='ONLINE_ORDER_INVALID_OPERATION';
  end if;
  select * into v_existing from public.online_order_operations where operation_id=p_operation_id;
  if found then
    if v_existing.order_id<>p_order_id or v_existing.action<>'extend_pickup' then
      raise exception using errcode='P0001',message='ONLINE_ORDER_OPERATION_CONFLICT';
    end if;
    return v_existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;
  select * into v_order from public.online_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0001',message='ONLINE_ORDER_NOT_FOUND'; end if;
  if v_order.fulfillment_method<>'store_pickup' or v_order.payment_status<>'paid'
     or v_order.status<>'ready_for_pickup'
     or v_order.fulfillment_status not in ('ready_for_pickup','pickup_overdue') then
    raise exception using errcode='P0001',message='ONLINE_ORDER_INVALID_TRANSITION';
  end if;
  update public.online_orders
  set fulfillment_status='ready_for_pickup',
      pickup_expires_at=(case when pickup_expires_at is not null and pickup_expires_at>pg_catalog.now() then pickup_expires_at else pg_catalog.now() end)+pg_catalog.make_interval(days=>p_days),
      updated_at=pg_catalog.now()
  where id=p_order_id;
  v_result:=app_private.online_order_payload(p_order_id,false);
  insert into public.online_order_operations(operation_id,order_id,action,request_fingerprint,result,actor,previous_status,next_status,note)
  values(p_operation_id,p_order_id,'extend_pickup',p_days::text,v_result,p_actor,v_order.fulfillment_status,'ready_for_pickup',pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note,'')),''),500));
  return v_result;
end;
$$;

revoke all on function public.online_order_extend_pickup_rpc(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.online_order_extend_pickup_rpc(uuid,text,text,integer,text) to service_role;

create or replace function public.online_order_expire_pending_rpc(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order record;
  v_row record;
  v_count integer:=0;
  v_pickup_overdue_count integer:=0;
  v_operation_id text;
begin
  if p_limit<1 or p_limit>500 then raise exception using errcode='P0001',message='ONLINE_ORDER_INVALID_LIMIT'; end if;
  for v_order in
    select id from public.online_orders
    where status='pending_payment' and payment_status in ('pending','payment_order_created','awaiting_confirmation')
      and coalesce(payment_expires_at,created_at+interval '30 minutes')<=pg_catalog.now()
    order by created_at for update skip locked limit p_limit
  loop
    v_operation_id:='expire:'||v_order.id::text;
    if exists(
      select 1 from public.online_order_items i
      join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id and b.quantity_reserved<i.quantity
    ) then
      update public.online_orders set fulfillment_status='reconciliation_required',updated_at=pg_catalog.now() where id=v_order.id;
      continue;
    end if;
    for v_row in select i.variant_id,i.quantity,b.id balance_id,b.quantity_on_hand,b.quantity_reserved,l.id location_id
      from public.online_order_items i join public.inventory_locations l on l.code='MAIN_STORE' and l.active
      join public.inventory_balances b on b.variant_id=i.variant_id and b.location_id=l.id
      where i.order_id=v_order.id order by i.variant_id for update of b
    loop
      update public.inventory_balances set quantity_reserved=quantity_reserved-v_row.quantity,updated_at=pg_catalog.now() where id=v_row.balance_id;
      insert into public.stock_movements(variant_id,location_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,idempotency_key,created_by)
      values(v_row.variant_id,v_row.location_id,'release_reservation',0,v_row.quantity_on_hand,v_row.quantity_on_hand,'Online payment expired','online_order',v_order.id::text,v_operation_id||':'||v_row.variant_id::text||':release','system:online-order-expiry')
      on conflict(idempotency_key) do nothing;
    end loop;
    update public.online_orders set status='expired',payment_status='expired',fulfillment_status='expired',updated_at=pg_catalog.now() where id=v_order.id;
    update public.online_payment_attempts set status='expired',updated_at=pg_catalog.now() where order_id=v_order.id and status<>'paid';
    v_count:=v_count+1;
  end loop;
  with overdue as (
    select id from public.online_orders
    where status='ready_for_pickup'
      and fulfillment_method='store_pickup'
      and payment_status='paid'
      and pickup_expires_at is not null
      and pickup_expires_at<=pg_catalog.now()
      and fulfillment_status='ready_for_pickup'
    order by pickup_expires_at
    for update skip locked
    limit p_limit
  ), updated as (
    update public.online_orders o
    set fulfillment_status='pickup_overdue',updated_at=pg_catalog.now()
    from overdue
    where o.id=overdue.id
    returning o.id
  ) select pg_catalog.count(*)::integer into v_pickup_overdue_count from updated;
  return pg_catalog.jsonb_build_object('ok',true,'expired',v_count,'pickupOverdue',v_pickup_overdue_count);
end;
$$;

revoke all on function public.online_order_expire_pending_rpc(integer) from public,anon,authenticated;
grant execute on function public.online_order_expire_pending_rpc(integer) to service_role;

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
    'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0),
    'fulfillment_profile', coalesce(v.fulfillment_profile_override, p.fulfillment_profile, 'boxnow_and_pickup')
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
      'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0),
      'fulfillment_profile', coalesce(v.fulfillment_profile_override, p.fulfillment_profile, 'boxnow_and_pickup')
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

-- Checkout pricing needs package measurements to mirror the transaction gate,
-- but these internal shipping values must not be exposed by the public catalog RPC.
create or replace function public.product_checkout_variants_batch_rpc(p_product_skus text[])
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
      'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0),
      'fulfillment_profile', coalesce(v.fulfillment_profile_override, p.fulfillment_profile, 'boxnow_and_pickup'),
      'package_weight_grams', p.package_weight_grams,
      'package_length_mm', p.package_length_mm,
      'package_width_mm', p.package_width_mm,
      'package_height_mm', p.package_height_mm
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

revoke all on function public.product_checkout_variants_batch_rpc(text[]) from public, anon, authenticated;
grant execute on function public.product_checkout_variants_batch_rpc(text[]) to service_role;

create or replace function public.online_commerce_runtime_health_rpc()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select pg_catalog.jsonb_build_object(
    'ready',
      pg_catalog.to_regprocedure('public.online_checkout_prepare_rpc(text,text,text,jsonb,jsonb,text,jsonb,boolean,boolean,numeric,numeric,numeric,integer,text,text,text,timestamp with time zone)') is not null
      and pg_catalog.to_regprocedure('public.online_checkout_bind_viva_rpc(text,text,uuid,text,timestamp with time zone)') is not null
      and pg_catalog.to_regprocedure('public.online_payment_confirm_rpc(text,text,text,text,integer,text,text,boolean)') is not null
      and pg_catalog.to_regprocedure('public.online_order_expire_pending_rpc(integer)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_prepare_rpc(uuid,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_complete_rpc(uuid,text,text,text,text,boolean)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_cancel_prepare_rpc(uuid,text,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_cancel_complete_rpc(uuid,text,boolean,text,boolean)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_refresh_rpc(uuid,text,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_order_transition_rpc(uuid,text,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_order_extend_pickup_rpc(uuid,text,text,integer,text)') is not null
      and pg_catalog.to_regprocedure('public.product_checkout_variants_batch_rpc(text[])') is not null
      and exists(select 1 from public.inventory_locations where code='MAIN_STORE' and active),
    'checkoutRpc',pg_catalog.to_regprocedure('public.online_checkout_prepare_rpc(text,text,text,jsonb,jsonb,text,jsonb,boolean,boolean,numeric,numeric,numeric,integer,text,text,text,timestamp with time zone)') is not null,
    'paymentRpc',pg_catalog.to_regprocedure('public.online_payment_confirm_rpc(text,text,text,text,integer,text,text,boolean)') is not null,
    'shipmentRpc',pg_catalog.to_regprocedure('public.online_shipment_prepare_rpc(uuid,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_complete_rpc(uuid,text,text,text,text,boolean)') is not null,
    'shipmentCancelRpc',pg_catalog.to_regprocedure('public.online_shipment_cancel_prepare_rpc(uuid,text,text,text,text)') is not null
      and pg_catalog.to_regprocedure('public.online_shipment_cancel_complete_rpc(uuid,text,boolean,text,boolean)') is not null,
    'shipmentRefreshRpc',pg_catalog.to_regprocedure('public.online_shipment_refresh_rpc(uuid,text,text,text,text)') is not null,
    'transitionRpc',pg_catalog.to_regprocedure('public.online_order_transition_rpc(uuid,text,text,text,text)') is not null,
    'pickupExtensionRpc',pg_catalog.to_regprocedure('public.online_order_extend_pickup_rpc(uuid,text,text,integer,text)') is not null,
    'expiryRpc',pg_catalog.to_regprocedure('public.online_order_expire_pending_rpc(integer)') is not null,
    'mainStore',exists(select 1 from public.inventory_locations where code='MAIN_STORE' and active)
  );
$$;

revoke all on function public.online_commerce_runtime_health_rpc() from public,anon,authenticated;
grant execute on function public.online_commerce_runtime_health_rpc() to service_role;

commit;
