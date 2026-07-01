-- Add a conservative Skroutz feed stock threshold for existing stores.
-- New stores already get this column from supabase/client-init.sql.

alter table business_settings
  add column if not exists feed_min_stock int default 1;

update business_settings
set feed_min_stock = 1
where feed_min_stock is null or feed_min_stock < 1;
