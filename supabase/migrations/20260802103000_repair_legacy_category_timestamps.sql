begin;

-- Some existing customer databases created the category tables before the
-- baseline schema added updated_at. Keep this forward upgrade self-contained:
-- the trigger helper may also be absent on those databases.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

alter table public.product_categories
  add column if not exists updated_at timestamptz;

update public.product_categories
set updated_at = coalesce(created_at, pg_catalog.now())
where updated_at is null;

alter table public.product_categories
  alter column updated_at set default pg_catalog.now(),
  alter column updated_at set not null;

drop trigger if exists categories_updated_at on public.product_categories;
create trigger categories_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

alter table public.product_subcategories
  add column if not exists updated_at timestamptz;

update public.product_subcategories
set updated_at = coalesce(created_at, pg_catalog.now())
where updated_at is null;

alter table public.product_subcategories
  alter column updated_at set default pg_catalog.now(),
  alter column updated_at set not null;

drop trigger if exists subcategories_updated_at on public.product_subcategories;
create trigger subcategories_updated_at
before update on public.product_subcategories
for each row execute function public.set_updated_at();

commit;
