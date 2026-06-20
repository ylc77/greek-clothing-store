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

-- ── Category management tables ─────────────────────────────
create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_cn text not null default '',
  name_en text not null default '',
  name_gr text not null default '',
  image_url text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists product_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories(id) on delete cascade,
  slug text not null,
  name_cn text not null default '',
  name_en text not null default '',
  name_gr text not null default '',
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(category_id, slug)
);

alter table product_categories enable row level security;
alter table product_subcategories enable row level security;

create policy "Public read categories" on product_categories for select using (true);
create policy "Public read subcategories" on product_subcategories for select using (true);

-- Seed default categories
insert into product_categories (slug, name_cn, name_en, name_gr, sort_order) values
  ('women','女装','Women','Γυναικεία',1),('men','男装','Men','Ανδρικά',2),
  ('shoes','鞋子','Shoes','Παπούτσια',3),('bags','包包','Bags','Τσάντες',4),
  ('luggage','行李箱','Luggage','Βαλίτσες',5),('hats','帽子','Hats','Καπέλα',6),
  ('jewelry','首饰','Jewelry','Κοσμήματα',7),('other','其他','Other','Άλλα',8)
on conflict (slug) do nothing;

do $$ declare cid uuid;
begin
  select id into cid from product_categories where slug='men';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'tshirts','T恤','T-shirts','T-shirts',1),(cid,'shirts','衬衫','Shirts','Πουκάμισα',2),
    (cid,'hoodies','连帽卫衣','Hoodies','Φούτερ',3),(cid,'jackets','外套','Jackets','Μπουφάν',4),
    (cid,'trousers','长裤','Trousers','Παντελόνια',5),(cid,'jeans','牛仔裤','Jeans','Τζιν',6),
    (cid,'shorts','短裤','Shorts','Σορτς',7) on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='women';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'dresses','连衣裙','Dresses','Φορέματα',1),(cid,'tops','上衣','Tops','Τοπ',2),
    (cid,'shirts','衬衫','Shirts','Πουκάμισα',3),(cid,'hoodies','连帽卫衣','Hoodies','Φούτερ',4),
    (cid,'jackets','外套','Jackets','Μπουφάν',5),(cid,'trousers','长裤','Trousers','Παντελόνια',6),
    (cid,'skirts','半身裙','Skirts','Φούστες',7) on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='shoes';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'sneakers','运动鞋','Sneakers','Sneakers',1),(cid,'boots','靴子','Boots','Μπότες',2),
    (cid,'sandals','凉鞋','Sandals','Σανδάλια',3),(cid,'heels','高跟鞋','Heels','Γόβες',4)
    on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='bags';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'handbags','手提包','Handbags','Τσάντες χειρός',1),(cid,'backpacks','双肩包','Backpacks','Σακίδια',2),
    (cid,'wallets','钱包','Wallets','Πορτοφόλια',3) on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='luggage';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'suitcases','行李箱','Suitcases','Βαλίτσες',1),(cid,'travel_bags','旅行包','Travel Bags','Ταξιδιωτικές τσάντες',2)
    on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='hats';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'caps','鸭舌帽','Caps','Καπέλα',1),(cid,'beanies','针织帽','Beanies','Σκούφοι',2)
    on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='jewelry';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'necklaces','项链','Necklaces','Κολιέ',1),(cid,'bracelets','手链','Bracelets','Βραχιόλια',2),
    (cid,'earrings','耳环','Earrings','Σκουλαρίκια',3),(cid,'rings','戒指','Rings','Δαχτυλίδια',4)
    on conflict (category_id,slug) do nothing; end if;
  select id into cid from product_categories where slug='other';
  if cid is not null then insert into product_subcategories (category_id,slug,name_cn,name_en,name_gr,sort_order) values
    (cid,'accessories','配饰','Accessories','Αξεσουάρ',1) on conflict (category_id,slug) do nothing; end if;
end $$;
