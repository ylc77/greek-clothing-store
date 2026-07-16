begin;

-- RLS limits rows, not columns. Remove the historical table-wide SELECT grant
-- before allowing only the storefront/AI/Skroutz/sitemap contract below.
alter table public.products enable row level security;
revoke select on table public.products from anon, authenticated;

grant select (
  id,
  sku,
  name_gr,
  name_en,
  description_gr,
  description_en,
  category,
  subcategory,
  price,
  stock,
  sizes,
  size_system,
  size_stock,
  image_url,
  image_urls,
  brand,
  ean,
  vat,
  color,
  additional_image_urls,
  skroutz_url,
  material,
  fit,
  season,
  mpn,
  availability,
  size_chart,
  fit_type,
  ai_keywords,
  material_verified,
  category_path_en,
  category_path_gr,
  fiber_composition_gr,
  fiber_composition_en,
  care_instructions_gr,
  care_instructions_en,
  country_of_origin,
  manufacturer_name,
  manufacturer_contact,
  eu_responsible_person,
  product_safety_notes_gr,
  product_safety_notes_en,
  is_active,
  created_at,
  updated_at
) on table public.products to anon, authenticated;

-- Trusted server-side routes continue to require the service role. Repeating
-- this explicit grant keeps legacy upgrades independent of the baseline.
grant select, insert, update, delete on table public.products to service_role;
grant usage, select on sequence public.products_id_seq to service_role;

drop policy if exists "Public read active products" on public.products;
create policy "Public read active products"
on public.products
for select
to anon, authenticated
using (is_active = true);

notify pgrst, 'reload schema';

commit;
