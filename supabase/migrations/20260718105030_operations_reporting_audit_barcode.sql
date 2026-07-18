begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- Structured append-only audit metadata. Existing transaction RPCs already
-- insert audit_logs rows; the trigger below enriches those rows without
-- trusting a browser-provided role or user id.
alter table public.audit_logs
  add column if not exists actor_user_id uuid,
  add column if not exists actor_role text,
  add column if not exists auth_type text,
  add column if not exists event_version integer not null default 1;

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_role_check,
  drop constraint if exists audit_logs_auth_type_check,
  drop constraint if exists audit_logs_event_version_check;

alter table public.audit_logs
  add constraint audit_logs_actor_role_check check (
    actor_role is null or actor_role in ('owner', 'staff', 'inventory', 'readonly', 'developer', 'system', 'legacy')
  ),
  add constraint audit_logs_auth_type_check check (
    auth_type is null or auth_type in ('account', 'password', 'developer', 'system', 'legacy')
  ),
  add constraint audit_logs_event_version_check check (event_version > 0);

create index if not exists audit_logs_actor_user_created_idx
  on public.audit_logs (actor_user_id, created_at desc)
  where actor_user_id is not null;

create index if not exists audit_logs_action_created_idx
  on public.audit_logs (action, created_at desc);

create index if not exists stock_movements_source_reconciliation_idx
  on public.stock_movements (source_type, source_id, variant_id)
  where source_id is not null;

create or replace function app_private.audit_actor_parts(p_actor text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_match text[];
begin
  v_match := pg_catalog.regexp_match(
    v_actor,
    '^account:(owner|staff|inventory|readonly):([0-9a-fA-F-]{36})$'
  );
  if v_match is not null then
    begin
      return pg_catalog.jsonb_build_object(
        'auth_type', 'account',
        'actor_role', v_match[1],
        'actor_user_id', v_match[2]::uuid
      );
    exception when invalid_text_representation then
      null;
    end;
  end if;

  v_match := pg_catalog.regexp_match(v_actor, '^password:(owner|staff|inventory|readonly)$');
  if v_match is not null then
    return pg_catalog.jsonb_build_object(
      'auth_type', 'password',
      'actor_role', v_match[1],
      'actor_user_id', null
    );
  end if;

  if v_actor = 'developer' or v_actor like 'developer:%' then
    return pg_catalog.jsonb_build_object(
      'auth_type', 'developer',
      'actor_role', 'developer',
      'actor_user_id', null
    );
  end if;

  if v_actor = '' or v_actor = 'migration' or v_actor like 'system:%' then
    return pg_catalog.jsonb_build_object(
      'auth_type', 'system',
      'actor_role', 'system',
      'actor_user_id', null
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'auth_type', 'legacy',
    'actor_role', 'legacy',
    'actor_user_id', null
  );
end;
$$;

revoke execute on function app_private.audit_actor_parts(text) from public, anon, authenticated;

create or replace function app_private.audit_logs_enrich_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parts jsonb;
begin
  v_parts := app_private.audit_actor_parts(new.actor);
  new.auth_type := coalesce(new.auth_type, v_parts ->> 'auth_type');
  new.actor_role := coalesce(new.actor_role, v_parts ->> 'actor_role');
  new.actor_user_id := coalesce(new.actor_user_id, nullif(v_parts ->> 'actor_user_id', '')::uuid);
  return new;
end;
$$;

revoke execute on function app_private.audit_logs_enrich_trigger() from public, anon, authenticated;

drop trigger if exists audit_logs_enrich on public.audit_logs;
create trigger audit_logs_enrich
before insert on public.audit_logs
for each row execute function app_private.audit_logs_enrich_trigger();

update public.audit_logs
set
  auth_type = coalesce(auth_type, app_private.audit_actor_parts(actor) ->> 'auth_type'),
  actor_role = coalesce(actor_role, app_private.audit_actor_parts(actor) ->> 'actor_role'),
  actor_user_id = coalesce(actor_user_id, nullif(app_private.audit_actor_parts(actor) ->> 'actor_user_id', '')::uuid)
where auth_type is null or actor_role is null;

create or replace function app_private.audit_logs_immutable_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception using errcode = '42501', message = 'audit_logs is append-only';
end;
$$;

revoke execute on function app_private.audit_logs_immutable_trigger() from public, anon, authenticated;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function app_private.audit_logs_immutable_trigger();

revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant select on table public.audit_logs to service_role;

-- Capture POS and developer-only configuration events in the same audit log.
create or replace function app_private.audit_sales_order_insert_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (actor, action, entity, entity_id, before, after, metadata)
  values (
    new.created_by,
    case when new.source = 'pos' then 'pos_checkout' else 'order_created' end,
    'sales_order',
    new.id::text,
    null,
    pg_catalog.jsonb_build_object(
      'order_number', new.order_number,
      'status', new.status,
      'payment_status', new.payment_status,
      'total', new.total,
      'currency', new.currency
    ),
    pg_catalog.jsonb_build_object('source', new.source, 'idempotency_key', new.idempotency_key)
  );
  return new;
end;
$$;

drop trigger if exists audit_sales_order_insert on public.sales_orders;
create trigger audit_sales_order_insert
after insert on public.sales_orders
for each row execute function app_private.audit_sales_order_insert_trigger();

create or replace function app_private.audit_pos_void_movement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_type = 'pos_void' then
    insert into public.audit_logs (actor, action, entity, entity_id, before, after, metadata)
    values (
      new.created_by,
      'pos_void_restore',
      'sales_order',
      new.source_id,
      pg_catalog.jsonb_build_object('quantity_before', new.quantity_before),
      pg_catalog.jsonb_build_object('quantity_after', new.quantity_after),
      pg_catalog.jsonb_build_object(
        'movement_id', new.id,
        'variant_id', new.variant_id,
        'quantity_delta', new.quantity_delta,
        'reason', new.reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_pos_void_movement on public.stock_movements;
create trigger audit_pos_void_movement
after insert on public.stock_movements
for each row execute function app_private.audit_pos_void_movement_trigger();

create or replace function app_private.audit_developer_settings_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := 'developer';
begin
  if tg_table_name = 'feature_settings' then
    v_actor := coalesce(new.updated_by, 'developer');
  elsif tg_table_name = 'legal_settings_versions' then
    v_actor := coalesce(new.published_by, 'developer');
  end if;

  insert into public.audit_logs (actor, action, entity, entity_id, before, after, metadata)
  values (
    v_actor,
    case
      when tg_table_name = 'legal_settings_versions' then 'legal_settings_published'
      when tg_table_name = 'feature_settings' then 'feature_settings_changed'
      else 'business_settings_changed'
    end,
    tg_table_name,
    coalesce(new.id::text, '1'),
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else null end,
    pg_catalog.to_jsonb(new),
    pg_catalog.jsonb_build_object('operation', tg_op)
  );
  return new;
end;
$$;

drop trigger if exists audit_business_settings on public.business_settings;
create trigger audit_business_settings
after insert or update on public.business_settings
for each row execute function app_private.audit_developer_settings_trigger();

drop trigger if exists audit_feature_settings on public.feature_settings;
create trigger audit_feature_settings
after insert or update on public.feature_settings
for each row execute function app_private.audit_developer_settings_trigger();

drop trigger if exists audit_legal_settings_versions on public.legal_settings_versions;
create trigger audit_legal_settings_versions
after insert on public.legal_settings_versions
for each row execute function app_private.audit_developer_settings_trigger();

-- Keep immutable Greek and English order-item names for receipt reprints.
alter table public.sales_order_items
  add column if not exists name_en text,
  add column if not exists name_gr text;

update public.sales_order_items i
set
  name_en = coalesce(nullif(pg_catalog.btrim(p.name_en), ''), nullif(pg_catalog.btrim(p.name_gr), ''), i.product_sku),
  name_gr = coalesce(nullif(pg_catalog.btrim(p.name_gr), ''), nullif(pg_catalog.btrim(p.name_en), ''), i.product_sku)
from public.products p
where p.id = i.product_id
  and (i.name_en is null or i.name_gr is null);

create or replace function app_private.sales_order_item_localized_names_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name_en text;
  v_name_gr text;
begin
  select
    coalesce(nullif(pg_catalog.btrim(p.name_en), ''), nullif(pg_catalog.btrim(p.name_gr), ''), p.sku),
    coalesce(nullif(pg_catalog.btrim(p.name_gr), ''), nullif(pg_catalog.btrim(p.name_en), ''), p.sku)
  into v_name_en, v_name_gr
  from public.products p
  where p.id = new.product_id;

  new.name_en := coalesce(nullif(pg_catalog.btrim(new.name_en), ''), v_name_en, new.product_sku);
  new.name_gr := coalesce(nullif(pg_catalog.btrim(new.name_gr), ''), v_name_gr, new.product_sku);
  return new;
end;
$$;

drop trigger if exists sales_order_item_localized_names on public.sales_order_items;
create trigger sales_order_item_localized_names
before insert on public.sales_order_items
for each row execute function app_private.sales_order_item_localized_names_trigger();

create or replace function app_private.pos_order_payload(
  p_order_id uuid,
  p_already_processed boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'already_processed', coalesce(p_already_processed, false),
    'order', pg_catalog.jsonb_build_object(
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
      'refunded_at', o.refunded_at,
      'created_by', o.created_by
    ),
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', i.id,
          'product_id', i.product_id,
          'variant_id', i.variant_id,
          'product_sku', i.product_sku,
          'variant_sku', i.variant_sku,
          'barcode', i.barcode,
          'name', i.name,
          'name_en', i.name_en,
          'name_gr', i.name_gr,
          'size', i.size,
          'color', i.color,
          'quantity', i.quantity,
          'unit_price', i.unit_price,
          'discount_total', i.discount_total,
          'line_total', i.line_total
        ) order by i.created_at, i.id
      )
      from public.sales_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', p.id,
          'method', p.method,
          'amount', p.amount,
          'currency', p.currency,
          'status', p.status,
          'created_at', p.created_at
        ) order by p.created_at, p.id
      )
      from public.payments p
      where p.order_id = o.id
    ), '[]'::jsonb),
    'affected_product_ids', coalesce((
      select pg_catalog.jsonb_agg(distinct i.product_id)
      from public.sales_order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'affected_skus', coalesce((
      select pg_catalog.jsonb_agg(distinct i.product_sku)
      from public.sales_order_items i
      where i.order_id = o.id and i.product_sku is not null and pg_catalog.btrim(i.product_sku) <> ''
    ), '[]'::jsonb)
  )
  from public.sales_orders o
  where o.id = p_order_id;
$$;

revoke execute on function app_private.pos_order_payload(uuid, boolean) from public, anon, authenticated;

-- Per-order ledger reconciliation. This is private and only exposed through
-- bounded SECURITY DEFINER report functions granted to service_role.
create or replace view app_private.pos_order_reconciliation
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_number,
  o.status,
  o.payment_status,
  o.created_at,
  o.total,
  o.subtotal,
  o.discount_total,
  coalesce(items.item_count, 0)::integer as item_count,
  coalesce(items.item_quantity, 0)::integer as item_quantity,
  coalesce(items.item_total, 0)::numeric(12,2) as item_total,
  coalesce(payments.payment_count, 0)::integer as payment_count,
  coalesce(payments.payment_amount, 0)::numeric(12,2) as payment_amount,
  coalesce(payments.invalid_payment_status_count, 0)::integer as invalid_payment_status_count,
  coalesce(sale.sale_mismatch_count, 0)::integer as sale_movement_mismatch_count,
  coalesce(voids.void_mismatch_count, 0)::integer as void_movement_mismatch_count,
  (coalesce(items.item_count, 0) = 0) as missing_items,
  (pg_catalog.round(coalesce(items.item_total, 0), 2) <> pg_catalog.round(o.subtotal, 2)) as item_amount_mismatch,
  (pg_catalog.round(o.subtotal - o.discount_total, 2) <> pg_catalog.round(o.total, 2)) as order_amount_mismatch,
  (
    coalesce(payments.payment_count, 0) = 0
    or pg_catalog.round(coalesce(payments.payment_amount, 0), 2) <> pg_catalog.round(o.total, 2)
    or coalesce(payments.invalid_payment_status_count, 0) > 0
  ) as payment_mismatch,
  (
    coalesce(items.item_count, 0) > 0
    and pg_catalog.round(coalesce(items.item_total, 0), 2) = pg_catalog.round(o.subtotal, 2)
    and pg_catalog.round(o.subtotal - o.discount_total, 2) = pg_catalog.round(o.total, 2)
    and coalesce(payments.payment_count, 0) > 0
    and pg_catalog.round(coalesce(payments.payment_amount, 0), 2) = pg_catalog.round(o.total, 2)
    and coalesce(payments.invalid_payment_status_count, 0) = 0
    and coalesce(sale.sale_mismatch_count, 0) = 0
    and coalesce(voids.void_mismatch_count, 0) = 0
  ) as healthy
from public.sales_orders o
left join lateral (
  select
    pg_catalog.count(*) as item_count,
    coalesce(pg_catalog.sum(i.quantity), 0) as item_quantity,
    coalesce(pg_catalog.sum(i.line_total), 0) as item_total
  from public.sales_order_items i where i.order_id = o.id
) items on true
left join lateral (
  select
    pg_catalog.count(*) as payment_count,
    coalesce(pg_catalog.sum(p.amount), 0) as payment_amount,
    pg_catalog.count(*) filter (
      where (o.status = 'completed' and p.status <> 'paid')
         or (o.status = 'voided' and p.status <> 'voided')
         or (o.status = 'refunded' and p.status <> 'refunded')
    ) as invalid_payment_status_count
  from public.payments p where p.order_id = o.id
) payments on true
left join lateral (
  select pg_catalog.count(*) filter (where coalesce(x.expected_quantity, 0) <> coalesce(x.actual_quantity, 0)) as sale_mismatch_count
  from (
    select coalesce(e.variant_id, a.variant_id) as variant_id, e.expected_quantity, a.actual_quantity
    from (
      select i.variant_id, pg_catalog.sum(i.quantity)::integer as expected_quantity
      from public.sales_order_items i where i.order_id = o.id group by i.variant_id
    ) e
    full join (
      select m.variant_id, pg_catalog.sum(0 - m.quantity_delta)::integer as actual_quantity
      from public.stock_movements m
      where m.source_type = 'pos_sale' and m.source_id = o.id::text
      group by m.variant_id
    ) a using (variant_id)
  ) x
) sale on true
left join lateral (
  select pg_catalog.count(*) filter (where coalesce(x.expected_quantity, 0) <> coalesce(x.actual_quantity, 0)) as void_mismatch_count
  from (
    select coalesce(e.variant_id, a.variant_id) as variant_id, e.expected_quantity, a.actual_quantity
    from (
      select i.variant_id,
        case when o.status = 'voided' then pg_catalog.sum(i.quantity)::integer else 0 end as expected_quantity
      from public.sales_order_items i where i.order_id = o.id group by i.variant_id
    ) e
    full join (
      select m.variant_id, pg_catalog.sum(m.quantity_delta)::integer as actual_quantity
      from public.stock_movements m
      where m.source_type = 'pos_void' and m.source_id = o.id::text
      group by m.variant_id
    ) a using (variant_id)
  ) x
) voids on true
where o.source = 'pos';

revoke all on app_private.pos_order_reconciliation from public, anon, authenticated;

create or replace function public.pos_day_bounds_rpc(p_business_date date default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected as (
    select coalesce(p_business_date, (pg_catalog.now() at time zone 'Europe/Athens')::date) as business_date
  )
  select pg_catalog.jsonb_build_object(
    'date', business_date,
    'timezone', 'Europe/Athens',
    'start', business_date::timestamp at time zone 'Europe/Athens',
    'end', (business_date + 1)::timestamp at time zone 'Europe/Athens'
  ) from selected;
$$;

create or replace function public.pos_orders_page_rpc(
  p_query text default '',
  p_status text default 'all',
  p_payment_method text default 'all',
  p_date_range text default 'today',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := pg_catalog.btrim(coalesce(p_query, ''));
  v_status text := pg_catalog.btrim(coalesce(p_status, 'all'));
  v_payment text := pg_catalog.btrim(coalesce(p_payment_method, 'all'));
  v_range text := pg_catalog.btrim(coalesce(p_date_range, 'today'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date := (pg_catalog.now() at time zone 'Europe/Athens')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if v_status not in ('all', 'completed', 'voided', 'refunded')
     or v_payment not in ('all', 'cash', 'card', 'other')
     or v_range not in ('today', 'yesterday', 'last7days', 'all') then
    raise exception using errcode = '22023', message = 'POS_REPORT_INVALID_FILTER';
  end if;

  if v_range <> 'all' then
    v_start := (
      case v_range when 'yesterday' then v_today - 1 when 'last7days' then v_today - 6 else v_today end
    )::timestamp at time zone 'Europe/Athens';
    v_end := (v_today + 1)::timestamp at time zone 'Europe/Athens';
  end if;

  with filtered as (
    select o.*
    from public.sales_orders o
    where o.source = 'pos'
      and (v_status = 'all' or o.status = v_status)
      and (v_start is null or o.created_at >= v_start)
      and (v_end is null or o.created_at < v_end)
      and (v_payment = 'all' or exists (
        select 1 from public.payments p where p.order_id = o.id and p.method = v_payment
      ))
      and (v_query = '' or o.order_number ilike '%' || v_query || '%' or exists (
        select 1 from public.sales_order_items i
        where i.order_id = o.id and (
          i.product_sku ilike '%' || v_query || '%'
          or i.variant_sku ilike '%' || v_query || '%'
          or i.name ilike '%' || v_query || '%'
          or coalesce(i.name_en, '') ilike '%' || v_query || '%'
          or coalesce(i.name_gr, '') ilike '%' || v_query || '%'
        )
      ))
  ), page as (
    select * from filtered order by created_at desc, id desc limit v_limit offset v_offset
  )
  select pg_catalog.jsonb_build_object(
    'orders', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'payment_status', o.payment_status,
        'source', o.source,
        'total', o.total,
        'currency', o.currency,
        'created_at', o.created_at,
        'completed_at', o.completed_at,
        'payment_method', payment.method,
        'payment_method_status', payment.status,
        'items_count', coalesce(items.items_count, 0),
        'created_by', o.created_by,
        'notes', o.notes
      ) order by o.created_at desc, o.id desc)
      from page o
      left join lateral (
        select p.method, p.status from public.payments p where p.order_id = o.id order by p.created_at, p.id limit 1
      ) payment on true
      left join lateral (
        select coalesce(pg_catalog.sum(i.quantity), 0)::integer as items_count from public.sales_order_items i where i.order_id = o.id
      ) items on true
    ), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'timezone', 'Europe/Athens'
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.pos_reconciliation_rpc(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_order_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select r.*
    from app_private.pos_order_reconciliation r
    where (p_order_id is null or r.order_id = p_order_id)
      and (p_start is null or r.created_at >= p_start)
      and (p_end is null or r.created_at < p_end)
      and not r.healthy
  ), page as (
    select * from filtered
    order by created_at desc, order_id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select pg_catalog.jsonb_build_object(
    'issue_count', (select pg_catalog.count(*) from filtered),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by created_at desc, order_id desc) from page), '[]'::jsonb),
    'limit', least(greatest(coalesce(p_limit, 100), 1), 500),
    'offset', greatest(coalesce(p_offset, 0), 0)
  );
$$;

create or replace function public.pos_daily_report_rpc(
  p_business_date date default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      coalesce(p_business_date, (pg_catalog.now() at time zone 'Europe/Athens')::date) as business_date
  ), ranged as (
    select
      business_date,
      business_date::timestamp at time zone 'Europe/Athens' as start_at,
      (business_date + 1)::timestamp at time zone 'Europe/Athens' as end_at
    from bounds
  ), orders as (
    select o.* from public.sales_orders o cross join ranged r
    where o.source = 'pos' and o.created_at >= r.start_at and o.created_at < r.end_at
  ), page as (
    select * from orders
    order by created_at desc, id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0)
  ), reconciliation as (
    select r.* from app_private.pos_order_reconciliation r cross join ranged d
    where r.created_at >= d.start_at and r.created_at < d.end_at and not r.healthy
  )
  select pg_catalog.jsonb_build_object(
    'date', ranged.business_date,
    'range', pg_catalog.jsonb_build_object('start', ranged.start_at, 'end', ranged.end_at, 'timezone', 'Europe/Athens'),
    'summary', pg_catalog.jsonb_build_object(
      'ordersTotal', (select pg_catalog.count(*) from orders),
      'completedOrders', (select pg_catalog.count(*) from orders where status = 'completed'),
      'voidedOrders', (select pg_catalog.count(*) from orders where status = 'voided'),
      'refundedOrders', (select pg_catalog.count(*) from orders where status = 'refunded'),
      'grossSales', coalesce((select pg_catalog.sum(total) from orders where status = 'completed'), 0),
      'voidedTotal', coalesce((select pg_catalog.sum(total) from orders where status = 'voided'), 0),
      'discountTotal', coalesce((select pg_catalog.sum(discount_total) from orders where status = 'completed'), 0),
      'netSales', coalesce((select pg_catalog.sum(total) from orders where status = 'completed'), 0),
      'itemsSold', coalesce((select pg_catalog.sum(i.quantity) from public.sales_order_items i join orders o on o.id = i.order_id where o.status = 'completed'), 0)
    ),
    'paymentMethods', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('method', method, 'amount', amount, 'count', count) order by method)
      from (
        select p.method, pg_catalog.sum(p.amount) as amount, pg_catalog.count(*) as count
        from public.payments p join orders o on o.id = p.order_id
        where o.status = 'completed' and p.status = 'paid' group by p.method
      ) x
    ), '[]'::jsonb),
    'topItems', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by quantity desc, variant_sku)
      from (
        select i.product_sku, i.variant_sku,
          coalesce(nullif(pg_catalog.btrim(i.name_gr), ''), nullif(pg_catalog.btrim(i.name_en), ''), i.product_sku) as name,
          pg_catalog.sum(i.quantity)::integer as quantity,
          pg_catalog.sum(i.line_total)::numeric(12,2) as total
        from public.sales_order_items i join orders o on o.id = i.order_id
        where o.status = 'completed'
        group by i.product_sku, i.variant_sku, i.name_gr, i.name_en
        order by quantity desc, i.variant_sku
        limit 20
      ) x
    ), '[]'::jsonb),
    'orders', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'payment_status', o.payment_status,
        'total', o.total,
        'currency', o.currency,
        'created_at', o.created_at,
        'payments_count', (select pg_catalog.count(*) from public.payments p where p.order_id = o.id),
        'items_count', (select coalesce(pg_catalog.sum(i.quantity), 0) from public.sales_order_items i where i.order_id = o.id)
      ) order by o.created_at desc, o.id desc) from page o
    ), '[]'::jsonb),
    'pagination', pg_catalog.jsonb_build_object(
      'total', (select pg_catalog.count(*) from orders),
      'limit', least(greatest(coalesce(p_limit, 100), 1), 200),
      'offset', greatest(coalesce(p_offset, 0), 0)
    ),
    'health', pg_catalog.jsonb_build_object(
      'issueOrders', (select pg_catalog.count(*) from reconciliation),
      'missingItems', (select pg_catalog.count(*) from reconciliation where missing_items),
      'itemAmountMismatches', (select pg_catalog.count(*) from reconciliation where item_amount_mismatch or order_amount_mismatch),
      'paymentMismatches', (select pg_catalog.count(*) from reconciliation where payment_mismatch),
      'saleMovementMismatches', (select pg_catalog.count(*) from reconciliation where sale_movement_mismatch_count > 0),
      'voidMovementMismatches', (select pg_catalog.count(*) from reconciliation where void_movement_mismatch_count > 0)
    )
  ) from ranged;
$$;

create or replace function public.pos_search_rpc(p_query text default '', p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with location as (
    select id from public.inventory_locations where code = 'MAIN_STORE' and active = true limit 1
  ), matched as (
    select
      p.id as product_id,
      v.id as variant_id,
      p.sku as product_sku,
      v.variant_sku,
      v.barcode,
      coalesce(nullif(pg_catalog.btrim(p.name_cn), ''), nullif(pg_catalog.btrim(p.name_en), ''), nullif(pg_catalog.btrim(p.name_gr), ''), p.sku) as name,
      v.size,
      v.color,
      coalesce(v.price, p.price, 0)::numeric(10,2) as price,
      b.quantity_on_hand,
      b.quantity_reserved,
      greatest(b.quantity_on_hand - b.quantity_reserved, 0) as quantity_available,
      p.is_active as product_active,
      v.active as variant_active,
      p.image_url,
      case
        when pg_catalog.btrim(coalesce(p_query, '')) = '' then 100
        when pg_catalog.lower(coalesce(v.barcode, '')) = pg_catalog.lower(pg_catalog.btrim(p_query)) then 0
        when pg_catalog.lower(v.variant_sku) = pg_catalog.lower(pg_catalog.btrim(p_query)) then 1
        when pg_catalog.lower(p.sku) = pg_catalog.lower(pg_catalog.btrim(p_query)) then 2
        when coalesce(v.barcode, '') ilike '%' || pg_catalog.btrim(p_query) || '%' then 3
        when v.variant_sku ilike '%' || pg_catalog.btrim(p_query) || '%' then 4
        when p.sku ilike '%' || pg_catalog.btrim(p_query) || '%' then 5
        else 6
      end as match_score,
      v.created_at
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join location l on true
    join public.inventory_balances b on b.variant_id = v.id and b.location_id = l.id
    where v.active = true and p.is_active = true
      and (
        pg_catalog.btrim(coalesce(p_query, '')) = ''
        or coalesce(v.barcode, '') ilike '%' || pg_catalog.btrim(p_query) || '%'
        or v.variant_sku ilike '%' || pg_catalog.btrim(p_query) || '%'
        or p.sku ilike '%' || pg_catalog.btrim(p_query) || '%'
        or coalesce(p.name_cn, '') ilike '%' || pg_catalog.btrim(p_query) || '%'
        or coalesce(p.name_en, '') ilike '%' || pg_catalog.btrim(p_query) || '%'
        or coalesce(p.name_gr, '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      )
    order by match_score, v.created_at desc, v.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(matched) - 'match_score' - 'created_at' order by match_score, created_at desc, variant_id) from matched), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from matched)
  );
$$;

-- Barcode changes are one database transaction with payload-bound replay.
create table if not exists public.barcode_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  client_request_id text not null unique,
  payload_fingerprint text not null,
  actor text not null,
  mode text not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint barcode_operations_request_check check (pg_catalog.btrim(client_request_id) <> '' and pg_catalog.length(client_request_id) <= 200),
  constraint barcode_operations_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint barcode_operations_actor_check check (pg_catalog.btrim(actor) <> '' and pg_catalog.length(actor) <= 300),
  constraint barcode_operations_mode_check check (mode in ('variant_sku', 'explicit')),
  constraint barcode_operations_result_check check (pg_catalog.jsonb_typeof(result) = 'object')
);

alter table public.barcode_operations enable row level security;
revoke all on table public.barcode_operations from public, anon, authenticated;
grant select, insert on table public.barcode_operations to service_role;

create or replace function public.variant_barcodes_apply_rpc(
  p_client_request_id text,
  p_assignments jsonb,
  p_mode text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_mode text := pg_catalog.btrim(coalesce(p_mode, ''));
  v_actor text := pg_catalog.btrim(coalesce(p_actor, ''));
  v_fingerprint text;
  v_existing public.barcode_operations%rowtype;
  v_assignment record;
  v_variant record;
  v_barcode text;
  v_updated jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_result jsonb;
  v_requested integer;
begin
  if v_request_id = '' or pg_catalog.length(v_request_id) > 200 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_REQUEST_ID';
  end if;
  if v_actor = '' or pg_catalog.length(v_actor) > 300 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_ACTOR';
  end if;
  if v_mode not in ('variant_sku', 'explicit') then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_MODE';
  end if;
  if p_assignments is null or pg_catalog.jsonb_typeof(p_assignments) <> 'array'
     or pg_catalog.jsonb_array_length(p_assignments) < 1
     or pg_catalog.jsonb_array_length(p_assignments) > 500 then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_ASSIGNMENTS';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_mode || ':' || p_assignments::text, 'UTF8'), 'sha256'::text
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barcode:' || v_request_id, 0));
  select * into v_existing from public.barcode_operations where client_request_id = v_request_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint or v_existing.actor <> v_actor then
      raise exception using errcode = '23505', message = 'BARCODE_OPERATION_CONFLICT';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('already_processed', true);
  end if;

  create temporary table if not exists pg_temp.barcode_assignments (
    variant_id uuid primary key,
    requested_barcode text
  ) on commit drop;
  truncate pg_temp.barcode_assignments;

  begin
    insert into pg_temp.barcode_assignments (variant_id, requested_barcode)
    select
      nullif(pg_catalog.btrim(value ->> 'variant_id'), '')::uuid,
      nullif(pg_catalog.btrim(value ->> 'barcode'), '')
    from pg_catalog.jsonb_array_elements(p_assignments);
  exception when others then
    raise exception using errcode = '22023', message = 'BARCODE_INVALID_ASSIGNMENTS';
  end;

  select pg_catalog.count(*) into v_requested from pg_temp.barcode_assignments;
  if v_requested <> pg_catalog.jsonb_array_length(p_assignments) then
    raise exception using errcode = '22023', message = 'BARCODE_DUPLICATE_VARIANT';
  end if;

  for v_assignment in select * from pg_temp.barcode_assignments order by variant_id
  loop
    select id, variant_sku, barcode into v_variant
    from public.product_variants where id = v_assignment.variant_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'BARCODE_VARIANT_NOT_FOUND';
    end if;

    v_barcode := case when v_mode = 'variant_sku' then pg_catalog.btrim(v_variant.variant_sku) else v_assignment.requested_barcode end;
    if v_barcode is null or v_barcode = '' or pg_catalog.length(v_barcode) > 200 then
      raise exception using errcode = '22023', message = 'BARCODE_INVALID_VALUE';
    end if;

    if nullif(pg_catalog.btrim(coalesce(v_variant.barcode, '')), '') = v_barcode
       or (v_mode = 'variant_sku' and nullif(pg_catalog.btrim(coalesce(v_variant.barcode, '')), '') is not null) then
      v_skipped := v_skipped || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', v_variant.id, 'variant_sku', v_variant.variant_sku, 'barcode', v_barcode
      ));
      continue;
    end if;

    if nullif(pg_catalog.btrim(coalesce(v_variant.barcode, '')), '') is not null
       and exists (select 1 from public.stock_movements m where m.variant_id = v_variant.id) then
      raise exception using errcode = '55000', message = 'BARCODE_HISTORY_LOCKED';
    end if;

    begin
      update public.product_variants
      set barcode = v_barcode, updated_at = pg_catalog.now()
      where id = v_variant.id;
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'BARCODE_ALREADY_IN_USE';
    end;

    v_updated := v_updated || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_variant.id, 'variant_sku', v_variant.variant_sku, 'barcode', v_barcode
    ));
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'updated_variants', v_updated,
    'skipped_variants', v_skipped,
    'generated_count', pg_catalog.jsonb_array_length(v_updated),
    'skipped_count', pg_catalog.jsonb_array_length(v_skipped),
    'already_processed', false
  );

  insert into public.barcode_operations (client_request_id, payload_fingerprint, actor, mode, result)
  values (v_request_id, v_fingerprint, v_actor, v_mode, v_result);

  insert into public.audit_logs (actor, action, entity, entity_id, metadata)
  values (
    v_actor,
    'variant_barcodes_applied',
    'barcode_operation',
    v_request_id,
    pg_catalog.jsonb_build_object('mode', v_mode, 'updated', pg_catalog.jsonb_array_length(v_updated), 'skipped', pg_catalog.jsonb_array_length(v_skipped))
  );

  return v_result;
end;
$$;

create or replace function public.operations_runtime_health_rpc()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ready',
      pg_catalog.to_regprocedure('public.pos_daily_report_rpc(date,integer,integer)') is not null
      and pg_catalog.to_regprocedure('public.pos_orders_page_rpc(text,text,text,text,integer,integer)') is not null
      and pg_catalog.to_regprocedure('public.pos_reconciliation_rpc(timestamp with time zone,timestamp with time zone,uuid,integer,integer)') is not null
      and pg_catalog.to_regprocedure('public.pos_search_rpc(text,integer)') is not null
      and pg_catalog.to_regprocedure('public.variant_barcodes_apply_rpc(text,jsonb,text,text)') is not null,
    'version', 'operations-v1',
    'timezone', 'Europe/Athens',
    'audit_append_only', not pg_catalog.has_table_privilege('service_role', 'public.audit_logs', 'UPDATE')
      and not pg_catalog.has_table_privilege('service_role', 'public.audit_logs', 'DELETE'),
    'reporting_deployed', pg_catalog.to_regprocedure('public.pos_daily_report_rpc(date,integer,integer)') is not null,
    'barcode_deployed', pg_catalog.to_regprocedure('public.variant_barcodes_apply_rpc(text,jsonb,text,text)') is not null
  );
$$;

revoke execute on function public.pos_day_bounds_rpc(date) from public, anon, authenticated;
revoke execute on function public.pos_orders_page_rpc(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.pos_reconciliation_rpc(timestamptz, timestamptz, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.pos_daily_report_rpc(date, integer, integer) from public, anon, authenticated;
revoke execute on function public.pos_search_rpc(text, integer) from public, anon, authenticated;
revoke execute on function public.variant_barcodes_apply_rpc(text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.operations_runtime_health_rpc() from public, anon, authenticated;

grant execute on function public.pos_day_bounds_rpc(date) to service_role;
grant execute on function public.pos_orders_page_rpc(text, text, text, text, integer, integer) to service_role;
grant execute on function public.pos_reconciliation_rpc(timestamptz, timestamptz, uuid, integer, integer) to service_role;
grant execute on function public.pos_daily_report_rpc(date, integer, integer) to service_role;
grant execute on function public.pos_search_rpc(text, integer) to service_role;
grant execute on function public.variant_barcodes_apply_rpc(text, jsonb, text, text) to service_role;
grant execute on function public.operations_runtime_health_rpc() to service_role;

commit;
