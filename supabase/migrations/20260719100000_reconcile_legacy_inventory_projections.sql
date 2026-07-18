begin;

do $$
begin
  if not exists (
    select 1
    from public.inventory_locations
    where code = 'MAIN_STORE'
      and active
  ) then
    raise exception 'INVENTORY_RUNTIME_UNAVAILABLE: active MAIN_STORE is required';
  end if;
end;
$$;

-- inventory_balances is authoritative. Older pre-release databases can have
-- correct balances while the compatibility fields on products still use the
-- legacy empty ONE SIZE representation. Bring those projections into the same
-- shape produced by the transactional product and inventory RPCs.
with expected_projection as (
  select
    p.id as product_id,
    coalesce((
      select pg_catalog.sum(b.quantity_on_hand)::integer
      from public.product_variants v
      join public.inventory_locations l
        on l.code = 'MAIN_STORE'
       and l.active
      join public.inventory_balances b
        on b.variant_id = v.id
       and b.location_id = l.id
      where v.product_id = p.id
        and v.active
    ), 0) as stock,
    coalesce((
      select pg_catalog.string_agg(
        pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))),
        ',' order by v.sort_order, v.id
      )
      from public.product_variants v
      where v.product_id = p.id
        and v.active
    ), '') as sizes,
    coalesce((
      select pg_catalog.jsonb_object_agg(
        x.size_label,
        x.quantity_on_hand
        order by x.sort_order, x.variant_id
      )
      from (
        select
          pg_catalog.upper(pg_catalog.btrim(coalesce(v.size, 'ONE SIZE'))) as size_label,
          b.quantity_on_hand,
          v.sort_order,
          v.id as variant_id
        from public.product_variants v
        join public.inventory_locations l
          on l.code = 'MAIN_STORE'
         and l.active
        join public.inventory_balances b
          on b.variant_id = v.id
         and b.location_id = l.id
        where v.product_id = p.id
          and v.active
      ) x
    ), '{}'::jsonb) as size_stock
  from public.products p
)
update public.products p
set
  stock = e.stock,
  sizes = e.sizes,
  size_stock = e.size_stock,
  updated_at = pg_catalog.now()
from expected_projection e
where e.product_id = p.id
  and (
    p.stock is distinct from e.stock
    or p.sizes is distinct from e.sizes
    or p.size_stock is distinct from e.size_stock
  );

commit;
