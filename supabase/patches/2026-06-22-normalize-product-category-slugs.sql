-- Normalize existing category/subcategory data to lowercase
-- Handles legacy data like "Men" -> "men", "T-shirts" -> "t-shirts"
-- Frontend now uses ilike for queries, but clean data is safer

update products set category = lower(trim(category)) where category is not null and category != lower(trim(category));
update products set subcategory = lower(trim(replace(subcategory, ' ', '-'))) where subcategory is not null and subcategory != lower(trim(replace(subcategory, ' ', '-')));
