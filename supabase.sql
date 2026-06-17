create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name_cn text,
  name_gr text not null,
  name_en text not null,
  description_cn text,
  description_gr text,
  description_en text,
  category text not null check (category in ('men', 'women', 'shoes', 'bags', 'luggage', 'hats', 'jewelry', 'other')),
  subcategory text,
  price numeric(10, 2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  sizes text,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table products add column if not exists name_cn text;
alter table products add column if not exists description_cn text;
alter table products add column if not exists sizes text;
alter table products add column if not exists subcategory text;

alter table products add column if not exists image_urls jsonb default '[]'::jsonb;
alter table products add column if not exists brand text;
alter table products add column if not exists barcode text;
alter table products add column if not exists ean text;
alter table products add column if not exists vat numeric(5,2) default 24;
alter table products add column if not exists color text;
alter table products add column if not exists additional_image_urls text;
alter table products add column if not exists skroutz_url text;
alter table products add column if not exists material text;
alter table products add column if not exists fit text;
alter table products add column if not exists season text;
alter table products add column if not exists mpn text;
alter table products add column if not exists availability text;
alter table products add column if not exists category_path_en text;
alter table products add column if not exists category_path_gr text;
alter table products add column if not exists is_active boolean default true;
alter table products add column if not exists updated_at timestamptz default now();

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'products_updated_at') then
    create trigger products_updated_at
      before update on products
      for each row execute function update_updated_at();
  end if;
end;
$$;

create index if not exists products_created_at_idx on products (created_at desc);
create index if not exists products_category_idx on products (category);
create index if not exists products_category_subcategory_idx on products (category, subcategory);

alter table products enable row level security;

drop policy if exists "Public read products" on products;
create policy "Public read products"
on products
for select
using (true);

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update
set public = true;
