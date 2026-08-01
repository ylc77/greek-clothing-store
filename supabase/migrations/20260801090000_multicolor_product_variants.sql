begin;

-- A catalog Variant is a product + normalized size + normalized color. The
-- earlier pre-release RPC already persisted color, but rejected a second row
-- with the same size even when the color differed.
create unique index if not exists product_variants_product_size_color_ci_unique
on public.product_variants (
  product_id,
  pg_catalog.upper(pg_catalog.btrim(coalesce(size, 'ONE SIZE'))),
  pg_catalog.lower(pg_catalog.btrim(coalesce(color, '')))
);

create or replace function app_private.product_projection(p_product_id bigint)
returns table(stock integer, sizes text, size_stock jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with active_variants as (
    select
      pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))) as size_label,
      v.sort_order,
      v.id as variant_id,
      coalesce(b.quantity_on_hand, 0)::integer as quantity_on_hand
    from public.product_variants v
    join public.inventory_locations l
      on l.code = 'MAIN_STORE'
     and l.active
    left join public.inventory_balances b
      on b.variant_id = v.id
     and b.location_id = l.id
    where v.product_id = p_product_id
      and v.active
  ), size_totals as (
    select
      size_label,
      pg_catalog.min(sort_order) as sort_order,
      pg_catalog.sum(quantity_on_hand)::integer as quantity_on_hand
    from active_variants
    group by size_label
  )
  select
    coalesce(pg_catalog.sum(quantity_on_hand), 0)::integer as stock,
    coalesce(pg_catalog.string_agg(size_label, ',' order by sort_order, size_label), '') as sizes,
    coalesce(
      pg_catalog.jsonb_object_agg(size_label, quantity_on_hand order by sort_order, size_label),
      '{}'::jsonb
    ) as size_stock
  from size_totals;
$$;

revoke all on function app_private.product_projection(bigint)
from public, anon, authenticated, service_role;

create or replace function app_private.product_projection_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projection record;
begin
  select * into v_projection
  from app_private.product_projection(new.id);

  new.stock := coalesce(v_projection.stock, 0);
  new.sizes := coalesce(v_projection.sizes, '');
  new.size_stock := coalesce(v_projection.size_stock, '{}'::jsonb);
  return new;
end;
$$;

revoke all on function app_private.product_projection_before_write()
from public, anon, authenticated, service_role;

drop trigger if exists products_authoritative_inventory_projection on public.products;
create trigger products_authoritative_inventory_projection
before update of stock, sizes, size_stock on public.products
for each row execute function app_private.product_projection_before_write();

-- Preserve the mature transaction functions and patch only their catalog-key
-- validation. Existing operation IDs, locks, stock movements, audit records,
-- and fail-closed behavior remain unchanged.
do $migration$
declare
  v_signature pg_catalog.regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.product_create_rpc(text,jsonb,jsonb,text,text)'::pg_catalog.regprocedure,
    'public.product_update_rpc(text,bigint,bigint,bigint,jsonb,jsonb,text,text)'::pg_catalog.regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_signature::oid) into v_definition;

    if pg_catalog.strpos(v_definition, 'v_seen_catalog_keys') = 0 then
      if pg_catalog.strpos(v_definition, 'v_seen_sizes') = 0 then
        raise exception 'MULTICOLOR_MIGRATION_PRECONDITION: expected product RPC catalog validation was not found';
      end if;
      v_definition := pg_catalog.replace(v_definition, 'v_seen_sizes', 'v_seen_catalog_keys');
      v_definition := pg_catalog.replace(
        v_definition,
        'v_size = any(v_seen_catalog_keys)',
        '(pg_catalog.lower(v_size) || pg_catalog.chr(31) || pg_catalog.lower(v_color)) = any(v_seen_catalog_keys)'
      );
      v_definition := pg_catalog.replace(
        v_definition,
        'pg_catalog.array_append(v_seen_catalog_keys, v_size)',
        'pg_catalog.array_append(v_seen_catalog_keys, pg_catalog.lower(v_size) || pg_catalog.chr(31) || pg_catalog.lower(v_color))'
      );
      v_definition := pg_catalog.replace(
        v_definition,
        'variant_sku and normalized size must be unique within a product catalog',
        'variant_sku and normalized size/color must be unique within a product catalog'
      );
      if pg_catalog.strpos(v_definition, 'v_seen_sizes') > 0
         or pg_catalog.strpos(v_definition, 'v_size = any(v_seen_catalog_keys)') > 0 then
        raise exception 'MULTICOLOR_MIGRATION_PRECONDITION: product RPC catalog validation patch was incomplete';
      end if;
      execute v_definition;
    end if;
  end loop;
end;
$migration$;

-- The compatibility projection is intentionally size-only for legacy readers.
-- Multiple colors of L therefore produce one L key whose value is the sum of
-- all L Variants. Keep the mature reconciliation checks and replace only its
-- projection result through a private legacy implementation plus safe wrapper.
alter function public.product_reconciliation_rpc() set schema app_private;
alter function app_private.product_reconciliation_rpc() rename to product_reconciliation_legacy_rpc;
revoke all on function app_private.product_reconciliation_legacy_rpc()
from public, anon, authenticated, service_role;

create or replace function public.product_reconciliation_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy jsonb;
  v_projection_mismatches jsonb;
  v_healthy boolean;
begin
  v_legacy := app_private.product_reconciliation_legacy_rpc();

  with mismatches as (
    select
      p.id as product_id,
      p.sku,
      p.stock as actual_stock,
      projection.stock as expected_stock,
      p.sizes as actual_sizes,
      projection.sizes as expected_sizes,
      p.size_stock as actual_size_stock,
      projection.size_stock as expected_size_stock
    from public.products p
    cross join lateral app_private.product_projection(p.id) projection
    where p.stock is distinct from projection.stock
       or p.sizes is distinct from projection.sizes
       or p.size_stock is distinct from projection.size_stock
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', product_id,
        'sku', sku,
        'actual_stock', actual_stock,
        'expected_stock', expected_stock,
        'actual_sizes', actual_sizes,
        'expected_sizes', expected_sizes,
        'actual_size_stock', actual_size_stock,
        'expected_size_stock', expected_size_stock
      ) order by product_id
    ),
    '[]'::jsonb
  ) into v_projection_mismatches
  from mismatches;

  v_healthy := pg_catalog.jsonb_array_length(v_projection_mismatches) = 0
    and pg_catalog.jsonb_array_length(coalesce(v_legacy -> 'productsMissingVariants', '[]'::jsonb)) = 0
    and pg_catalog.jsonb_array_length(coalesce(v_legacy -> 'variantsMissingMainStoreBalances', '[]'::jsonb)) = 0
    and pg_catalog.jsonb_array_length(coalesce(v_legacy -> 'inactiveVariantsWithReserved', '[]'::jsonb)) = 0
    and pg_catalog.jsonb_array_length(coalesce(v_legacy -> 'hardenedProductsMissingCreateOperation', '[]'::jsonb)) = 0
    and pg_catalog.jsonb_array_length(coalesce(v_legacy -> 'initialMovementMismatches', '[]'::jsonb)) = 0;

  return v_legacy || pg_catalog.jsonb_build_object(
    'healthy', v_healthy,
    'projectionMismatches', v_projection_mismatches,
    'checked_at', pg_catalog.now()
  );
end;
$$;

revoke execute on function public.product_reconciliation_rpc()
from public, anon, authenticated;
grant execute on function public.product_reconciliation_rpc()
to service_role;

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
  if v_sku = '' or pg_catalog.length(v_sku) > 200 then
    return '[]'::jsonb;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'size', pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))),
        'color', pg_catalog.btrim(coalesce(v.color, '')),
        'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0)
      )
      order by v.sort_order, v.id
    ),
    '[]'::jsonb
  ) into v_result
  from public.products p
  join public.product_variants v
    on v.product_id = p.id
   and v.active
  join public.inventory_locations l
    on l.code = 'MAIN_STORE'
   and l.active
  left join public.inventory_balances b
    on b.variant_id = v.id
   and b.location_id = l.id
  where pg_catalog.lower(pg_catalog.btrim(p.sku)) = pg_catalog.lower(v_sku)
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
    where pg_catalog.btrim(value) <> ''
      and pg_catalog.length(pg_catalog.btrim(value)) <= 200
    limit 20
  ), variant_rows as (
    select
      p.sku,
      v.sort_order,
      v.id,
      pg_catalog.jsonb_build_object(
        'size', pg_catalog.upper(pg_catalog.btrim(coalesce(nullif(v.size, ''), 'ONE SIZE'))),
        'color', pg_catalog.btrim(coalesce(v.color, '')),
        'quantity_available', greatest(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0), 0)
      ) as item
    from requested r
    join public.products p
      on pg_catalog.lower(pg_catalog.btrim(p.sku)) = pg_catalog.lower(r.sku)
     and p.is_active is distinct from false
    join public.product_variants v
      on v.product_id = p.id
     and v.active
    join public.inventory_locations l
      on l.code = 'MAIN_STORE'
     and l.active
    left join public.inventory_balances b
      on b.variant_id = v.id
     and b.location_id = l.id
  ), grouped as (
    select sku, pg_catalog.jsonb_agg(item order by sort_order, id) as variants
    from variant_rows
    group by sku
  )
  select coalesce(pg_catalog.jsonb_object_agg(sku, variants), '{}'::jsonb)
  from grouped;
$$;

revoke all on function public.product_public_variants_batch_rpc(text[]) from public;
grant execute on function public.product_public_variants_batch_rpc(text[]) to anon, authenticated, service_role;

-- Repair compatibility projections for pre-existing products without changing
-- any authoritative Variant balance.
update public.products
set stock = stock,
    sizes = sizes,
    size_stock = size_stock;

commit;
