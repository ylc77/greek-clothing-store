begin;

-- Image dimensions are non-sensitive storefront metadata used to enforce the
-- public Skroutz image-quality contract. Keep the grant column-scoped so no
-- procurement, internal barcode, or concurrency metadata becomes public.
alter table public.products enable row level security;
revoke select (image_width, image_height) on table public.products from anon, authenticated;
grant select (image_width, image_height) on table public.products to anon, authenticated;

notify pgrst, 'reload schema';

commit;
