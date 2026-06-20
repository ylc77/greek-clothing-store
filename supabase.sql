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
alter table products add column if not exists size_stock jsonb default '{}'::jsonb;

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

-- Block anon writes — admin API uses service_role which bypasses RLS
drop policy if exists "Block anon insert" on products;
create policy "Block anon insert"
on products
for insert
with check (false);

drop policy if exists "Block anon update" on products;
create policy "Block anon update"
on products
for update
using (false);

drop policy if exists "Block anon delete" on products;
create policy "Block anon delete"
on products
for delete
using (false);

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update
set public = true;

-- ── Business settings table ──────────────────────────────
create table if not exists business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text default 'Fashion Boutique',
  logo_url text,
  hero_image_url text,
  description_cn text,
  description_en text,
  description_gr text,
  phone text,
  whatsapp text,
  instagram text,
  facebook text,
  tiktok text,
  address text,
  google_maps_url text,
  opening_hours text,
  footer_text text,
  enable_skroutz boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function update_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'settings_updated_at') then
    create trigger settings_updated_at
      before update on business_settings
      for each row execute function update_settings_updated_at();
  end if;
end;
$$;

insert into business_settings (business_name, description_en, description_gr, phone, whatsapp, instagram, address, google_maps_url, opening_hours, footer_text)
values (
  'Fashion Boutique',
  'Welcome to our online store.',
  'Καλώς ήρθατε στο ηλεκτρονικό μας κατάστημα.',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
where not exists (select 1 from business_settings);

alter table business_settings enable row level security;

drop policy if exists "Public read business_settings" on business_settings;
create policy "Public read business_settings"
on business_settings
for select
using (true);

drop policy if exists "Block anon insert settings" on business_settings;
create policy "Block anon insert settings"
on business_settings
for insert
with check (false);

drop policy if exists "Block anon update settings" on business_settings;
create policy "Block anon update settings"
on business_settings
for update
using (false);

drop policy if exists "Block anon delete settings" on business_settings;
create policy "Block anon delete settings"
on business_settings
for delete
using (false);
