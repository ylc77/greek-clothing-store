-- Restrict public product reads to active products only.
-- Service role admin APIs bypass RLS and can still manage inactive products.

alter table products enable row level security;

drop policy if exists "Public read products" on products;
create policy "Public read products" on products
  for select
  using (is_active is distinct from false);
