-- ============================================================
-- Fashion Boutique - new client Supabase initialization
-- Run this file in Supabase SQL Editor for a fresh project.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where possible.
-- Existing client upgrades should use files under supabase/patches/.
-- ============================================================

-- Helper: updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. products
-- ============================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name_cn text default '',
  name_gr text default '',
  name_en text default '',
  description_cn text default '',
  description_gr text default '',
  description_en text default '',
  category text not null,
  subcategory text default '',
  price numeric(10,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  sizes text default '',
  size_stock jsonb default '{}'::jsonb,
  image_url text default '',
  image_urls jsonb default '[]'::jsonb,
  image_width int,
  image_height int,
  brand text default '',
  barcode text default '',
  ean text default '',
  vat numeric(5,2) default 24,
  color text default '',
  additional_image_urls text default '',
  skroutz_url text default '',
  material text default '',
  fit text default '',
  season text default '',
  mpn text default '',
  availability text default '',
  size_chart jsonb default '{}'::jsonb,
  fit_type text default 'regular',
  style_tags text[] default '{}',
  ai_keywords text[] default '{}',
  material_verified boolean default false,
  category_path_en text default '',
  category_path_gr text default '',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists products_sku_idx on products (sku);
create index if not exists products_created_at_idx on products (created_at desc);
create index if not exists products_category_idx on products (category);
create index if not exists products_category_subcategory_idx on products (category, subcategory);
create index if not exists products_is_active_idx on products (is_active);

alter table products enable row level security;

drop policy if exists "Public read products" on products;
create policy "Public read products" on products
  for select
  using (is_active is distinct from false);

drop policy if exists "Block anon insert products" on products;
create policy "Block anon insert products" on products
  for insert
  with check (false);

drop policy if exists "Block anon update products" on products;
create policy "Block anon update products" on products
  for update
  using (false);

drop policy if exists "Block anon delete products" on products;
create policy "Block anon delete products" on products
  for delete
  using (false);

drop trigger if exists products_updated_at on products;
create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ============================================================
-- 2. business_settings
-- ============================================================
create table if not exists business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text default 'Fashion Boutique',
  logo_url text default '',
  hero_image_url text default '',
  description_cn text default '',
  description_en text default '',
  description_gr text default '',
  phone text default '',
  whatsapp text default '',
  instagram text default '',
  facebook text default '',
  tiktok text default '',
  address text default '',
  google_maps_url text default '',
  opening_hours text default '',
  footer_text text default '',
  enable_skroutz boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into business_settings (business_name, description_cn, description_en, description_gr)
values (
  'Fashion Boutique',
  '欢迎来到我们的在线商店。',
  'Welcome to our online store.',
  'Καλώς ήρθατε στο ηλεκτρονικό μας κατάστημα.'
)
where not exists (select 1 from business_settings);

alter table business_settings enable row level security;

drop policy if exists "Public read business_settings" on business_settings;
create policy "Public read business_settings" on business_settings
  for select
  using (true);

drop policy if exists "Block anon insert business_settings" on business_settings;
create policy "Block anon insert business_settings" on business_settings
  for insert
  with check (false);

drop policy if exists "Block anon update business_settings" on business_settings;
create policy "Block anon update business_settings" on business_settings
  for update
  using (false);

drop policy if exists "Block anon delete business_settings" on business_settings;
create policy "Block anon delete business_settings" on business_settings
  for delete
  using (false);

drop trigger if exists settings_updated_at on business_settings;
create trigger settings_updated_at
  before update on business_settings
  for each row execute function set_updated_at();

-- ============================================================
-- 3. product_categories
-- ============================================================
create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_cn text not null default '',
  name_en text not null default '',
  name_gr text not null default '',
  image_url text default '',
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists product_categories_sort_order_idx on product_categories (sort_order);

alter table product_categories enable row level security;

drop policy if exists "Public read categories" on product_categories;
create policy "Public read categories" on product_categories
  for select
  using (true);

drop trigger if exists categories_updated_at on product_categories;
create trigger categories_updated_at
  before update on product_categories
  for each row execute function set_updated_at();

-- ============================================================
-- 4. product_subcategories
-- ============================================================
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
  updated_at timestamptz default now(),
  unique(category_id, slug)
);

create index if not exists product_subcategories_category_id_idx on product_subcategories (category_id);
create index if not exists product_subcategories_sort_order_idx on product_subcategories (sort_order);

alter table product_subcategories enable row level security;

drop policy if exists "Public read subcategories" on product_subcategories;
create policy "Public read subcategories" on product_subcategories
  for select
  using (true);

drop trigger if exists subcategories_updated_at on product_subcategories;
create trigger subcategories_updated_at
  before update on product_subcategories
  for each row execute function set_updated_at();

-- ============================================================
-- 5. Storage buckets
-- ============================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('store-assets', 'store-assets', true)
on conflict (id) do update set public = true;

-- ============================================================
-- 6. Data API grants for new Supabase projects
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;
grant select on products, business_settings, product_categories, product_subcategories to anon, authenticated;
grant select, insert, update, delete on products, business_settings, product_categories, product_subcategories to service_role;

-- ============================================================
-- 7. Default categories
-- ============================================================
insert into product_categories (slug, name_cn, name_en, name_gr, sort_order) values
  ('women', '女装', 'Women', 'Γυναικεία', 1),
  ('men', '男装', 'Men', 'Ανδρικά', 2),
  ('shoes', '鞋子', 'Shoes', 'Παπούτσια', 3),
  ('bags', '包包', 'Bags', 'Τσάντες', 4),
  ('luggage', '行李箱', 'Luggage', 'Βαλίτσες', 5),
  ('hats', '帽子', 'Hats', 'Καπέλα', 6),
  ('jewelry', '首饰', 'Jewelry', 'Κοσμήματα', 7),
  ('other', '其他', 'Other', 'Άλλα', 8)
on conflict (slug) do nothing;

do $$
declare
  cid uuid;
begin
  select id into cid from product_categories where slug = 'women';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'dresses', '连衣裙', 'Dresses', 'Φορέματα', 1),
      (cid, 'tops', '上衣', 'Tops', 'Τοπ', 2),
      (cid, 'shirts', '衬衫', 'Shirts', 'Πουκάμισα', 3),
      (cid, 'hoodies', '卫衣', 'Hoodies', 'Φούτερ', 4),
      (cid, 'jackets', '外套', 'Jackets', 'Μπουφάν', 5),
      (cid, 'trousers', '长裤', 'Trousers', 'Παντελόνια', 6),
      (cid, 'skirts', '半身裙', 'Skirts', 'Φούστες', 7)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'men';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'tshirts', 'T恤', 'T-shirts', 'T-shirts', 1),
      (cid, 'shirts', '衬衫', 'Shirts', 'Πουκάμισα', 2),
      (cid, 'hoodies', '卫衣', 'Hoodies', 'Φούτερ', 3),
      (cid, 'jackets', '外套', 'Jackets', 'Μπουφάν', 4),
      (cid, 'trousers', '长裤', 'Trousers', 'Παντελόνια', 5),
      (cid, 'jeans', '牛仔裤', 'Jeans', 'Τζιν', 6),
      (cid, 'shorts', '短裤', 'Shorts', 'Σορτς', 7)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'shoes';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'sneakers', '运动鞋', 'Sneakers', 'Sneakers', 1),
      (cid, 'boots', '靴子', 'Boots', 'Μπότες', 2),
      (cid, 'sandals', '凉鞋', 'Sandals', 'Σανδάλια', 3),
      (cid, 'heels', '高跟鞋', 'Heels', 'Γόβες', 4)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'bags';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'handbags', '手提包', 'Handbags', 'Τσάντες χειρός', 1),
      (cid, 'backpacks', '双肩包', 'Backpacks', 'Σακίδια', 2),
      (cid, 'wallets', '钱包', 'Wallets', 'Πορτοφόλια', 3)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'luggage';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'suitcases', '行李箱', 'Suitcases', 'Βαλίτσες', 1),
      (cid, 'travel_bags', '旅行包', 'Travel Bags', 'Ταξιδιωτικές τσάντες', 2)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'hats';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'caps', '鸭舌帽', 'Caps', 'Καπέλα', 1),
      (cid, 'beanies', '针织帽', 'Beanies', 'Σκούφοι', 2)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'jewelry';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'necklaces', '项链', 'Necklaces', 'Κολιέ', 1),
      (cid, 'bracelets', '手链', 'Bracelets', 'Βραχιόλια', 2),
      (cid, 'earrings', '耳环', 'Earrings', 'Σκουλαρίκια', 3),
      (cid, 'rings', '戒指', 'Rings', 'Δαχτυλίδια', 4)
    on conflict (category_id, slug) do nothing;
  end if;

  select id into cid from product_categories where slug = 'other';
  if cid is not null then
    insert into product_subcategories (category_id, slug, name_cn, name_en, name_gr, sort_order) values
      (cid, 'accessories', '配饰', 'Accessories', 'Αξεσουάρ', 1)
    on conflict (category_id, slug) do nothing;
  end if;
end $$;
