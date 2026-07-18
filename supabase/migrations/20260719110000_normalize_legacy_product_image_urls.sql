begin;

-- Some pre-baseline customer databases created products.image_urls as text[].
-- The transactional product RPCs use the current jsonb array contract, so a
-- legacy text[] column makes every product create/update fail closed when the
-- expression is first planned. Normalize the column without changing any URL.
do $$
declare
  v_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  into v_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.products'::pg_catalog.regclass
    and a.attname = 'image_urls'
    and not a.attisdropped;

  if v_type is null then
    raise exception 'products.image_urls is missing';
  elsif v_type = 'text[]' then
    alter table public.products alter column image_urls drop default;
    alter table public.products
      alter column image_urls type jsonb
      using pg_catalog.to_jsonb(coalesce(image_urls, array[]::text[]));
  elsif v_type <> 'jsonb' then
    raise exception 'Unsupported products.image_urls type: %', v_type;
  end if;

  if exists (
    select 1
    from public.products
    where image_urls is not null
      and pg_catalog.jsonb_typeof(image_urls) <> 'array'
  ) then
    raise exception 'products.image_urls contains a non-array JSON value';
  end if;

  update public.products
  set image_urls = '[]'::jsonb
  where image_urls is null;

  alter table public.products
    alter column image_urls set default '[]'::jsonb,
    alter column image_urls set not null;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.products'::pg_catalog.regclass
      and conname = 'products_image_urls_json_array_check'
  ) then
    alter table public.products
      add constraint products_image_urls_json_array_check
      check (pg_catalog.jsonb_typeof(image_urls) = 'array') not valid;
  end if;

  alter table public.products
    validate constraint products_image_urls_json_array_check;
end;
$$;

notify pgrst, 'reload schema';

commit;
