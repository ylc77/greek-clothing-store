begin;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  vat_number text,
  contact_name text,
  phone text,
  email text,
  address text,
  country text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_code_not_blank check (btrim(code) <> ''),
  constraint suppliers_name_not_blank check (btrim(name) <> '')
);

create index if not exists suppliers_active_name_idx
on public.suppliers (active, name);

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();

alter table public.products
  add column if not exists size_system text,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_style_code text,
  add column if not exists fiber_composition_gr text,
  add column if not exists fiber_composition_en text,
  add column if not exists care_instructions_gr text,
  add column if not exists care_instructions_en text,
  add column if not exists country_of_origin text,
  add column if not exists manufacturer_name text,
  add column if not exists manufacturer_contact text,
  add column if not exists eu_responsible_person text,
  add column if not exists product_safety_notes_gr text,
  add column if not exists product_safety_notes_en text;

alter table public.products
  drop constraint if exists products_size_system_check;
alter table public.products
  add constraint products_size_system_check check (
    size_system is null or size_system in (
      'letter',
      'eu_women_numeric',
      'eu_men_numeric',
      'eu_shoes',
      'one_size',
      'custom'
    )
  );

create index if not exists products_supplier_id_idx
on public.products (supplier_id);

create index if not exists products_supplier_style_code_idx
on public.products (supplier_style_code)
where supplier_style_code is not null and btrim(supplier_style_code) <> '';

alter table public.product_variants
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_sku text,
  add column if not exists reorder_level integer;

alter table public.product_variants
  drop constraint if exists product_variants_reorder_level_check;
alter table public.product_variants
  add constraint product_variants_reorder_level_check check (
    reorder_level is null or reorder_level >= 0
  );

create index if not exists product_variants_supplier_sku_idx
on public.product_variants (supplier_sku)
where supplier_sku is not null and btrim(supplier_sku) <> '';

create unique index if not exists product_variants_supplier_sku_unique_idx
on public.product_variants (supplier_id, supplier_sku)
where supplier_id is not null and supplier_sku is not null and btrim(supplier_sku) <> '';

alter table public.suppliers enable row level security;
revoke all on table public.suppliers from anon, authenticated;
grant select, insert, update, delete on table public.suppliers to service_role;
grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update, delete on table public.product_variants to service_role;

commit;
