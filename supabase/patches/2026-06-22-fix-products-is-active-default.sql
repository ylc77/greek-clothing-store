-- Fix: set is_active default to true and update existing NULLs
-- Old products created before is_active column existed have NULL values.
-- .neq('is_active', false) in code handles this, but DB should be clean too.

alter table products alter column is_active set default true;
update products set is_active = true where is_active is null;
