create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name_gr text not null,
  name_en text not null,
  description_gr text,
  description_en text,
  category text not null check (category in ('men', 'women', 'shoes', 'bags', 'luggage', 'hats', 'jewelry', 'other')),
  price numeric(10, 2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists products_created_at_idx on products (created_at desc);
create index if not exists products_category_idx on products (category);

alter table products enable row level security;

drop policy if exists "Public read products" on products;
create policy "Public read products"
on products
for select
using (true);
