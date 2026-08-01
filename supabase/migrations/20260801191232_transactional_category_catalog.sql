begin;

create or replace function public.category_catalog_apply_rpc(
  p_categories jsonb,
  p_subcategories jsonb,
  p_deleted_category_ids uuid[] default '{}'::uuid[],
  p_deleted_subcategory_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_slug text;
  v_subcategory_slug text;
  v_saved_categories integer := 0;
  v_saved_subcategories integer := 0;
  v_deleted_categories integer := 0;
  v_deleted_subcategories integer := 0;
begin
  if jsonb_typeof(p_categories) <> 'array' or jsonb_typeof(p_subcategories) <> 'array' then
    raise exception 'CATEGORY_CATALOG_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  if jsonb_array_length(p_categories) > 100 or jsonb_array_length(p_subcategories) > 1000 then
    raise exception 'CATEGORY_CATALOG_LIMIT_EXCEEDED' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.product_categories existing
    join jsonb_to_recordset(p_categories) as incoming(id uuid, slug text)
      on incoming.id = existing.id
    where incoming.slug is distinct from existing.slug
  ) then
    raise exception 'CATEGORY_SLUG_IMMUTABLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.product_subcategories existing
    join jsonb_to_recordset(p_subcategories) as incoming(id uuid, category_id uuid, slug text)
      on incoming.id = existing.id
    where incoming.slug is distinct from existing.slug
       or incoming.category_id is distinct from existing.category_id
  ) then
    raise exception 'SUBCATEGORY_IDENTITY_IMMUTABLE' using errcode = 'P0001';
  end if;

  select category.slug
  into v_category_slug
  from public.product_categories category
  where category.id = any(coalesce(p_deleted_category_ids, '{}'::uuid[]))
    and exists (
      select 1
      from public.products product
      where product.category = category.slug
    )
  order by category.slug
  limit 1;

  if v_category_slug is not null then
    raise exception 'CATEGORY_IN_USE:%', v_category_slug using errcode = 'P0001';
  end if;

  select category.slug, subcategory.slug
  into v_category_slug, v_subcategory_slug
  from public.product_subcategories subcategory
  join public.product_categories category on category.id = subcategory.category_id
  where subcategory.id = any(coalesce(p_deleted_subcategory_ids, '{}'::uuid[]))
    and exists (
      select 1
      from public.products product
      where product.category = category.slug
        and product.subcategory = subcategory.slug
    )
  order by category.slug, subcategory.slug
  limit 1;

  if v_subcategory_slug is not null then
    raise exception 'SUBCATEGORY_IN_USE:%/%', v_category_slug, v_subcategory_slug using errcode = 'P0001';
  end if;

  insert into public.product_categories (
    id,
    slug,
    name_cn,
    name_en,
    name_gr,
    image_url,
    sort_order,
    is_active
  )
  select
    incoming.id,
    incoming.slug,
    incoming.name_cn,
    incoming.name_en,
    incoming.name_gr,
    incoming.image_url,
    incoming.sort_order,
    incoming.is_active
  from jsonb_to_recordset(p_categories) as incoming(
    id uuid,
    slug text,
    name_cn text,
    name_en text,
    name_gr text,
    image_url text,
    sort_order integer,
    is_active boolean
  )
  on conflict (id) do update set
    name_cn = excluded.name_cn,
    name_en = excluded.name_en,
    name_gr = excluded.name_gr,
    image_url = excluded.image_url,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;
  get diagnostics v_saved_categories = row_count;

  insert into public.product_subcategories (
    id,
    category_id,
    slug,
    name_cn,
    name_en,
    name_gr,
    sort_order,
    is_active
  )
  select
    incoming.id,
    incoming.category_id,
    incoming.slug,
    incoming.name_cn,
    incoming.name_en,
    incoming.name_gr,
    incoming.sort_order,
    incoming.is_active
  from jsonb_to_recordset(p_subcategories) as incoming(
    id uuid,
    category_id uuid,
    slug text,
    name_cn text,
    name_en text,
    name_gr text,
    sort_order integer,
    is_active boolean
  )
  on conflict (id) do update set
    name_cn = excluded.name_cn,
    name_en = excluded.name_en,
    name_gr = excluded.name_gr,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;
  get diagnostics v_saved_subcategories = row_count;

  delete from public.product_subcategories
  where id = any(coalesce(p_deleted_subcategory_ids, '{}'::uuid[]));
  get diagnostics v_deleted_subcategories = row_count;

  delete from public.product_categories
  where id = any(coalesce(p_deleted_category_ids, '{}'::uuid[]));
  get diagnostics v_deleted_categories = row_count;

  if not exists (select 1 from public.product_categories where is_active = true) then
    raise exception 'ACTIVE_CATEGORY_REQUIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'savedCategories', v_saved_categories,
    'savedSubcategories', v_saved_subcategories,
    'deletedCategories', v_deleted_categories,
    'deletedSubcategories', v_deleted_subcategories
  );
end;
$$;

revoke all on function public.category_catalog_apply_rpc(jsonb, jsonb, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.category_catalog_apply_rpc(jsonb, jsonb, uuid[], uuid[]) to service_role;

commit;
