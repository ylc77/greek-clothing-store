-- Add material_verified flag for AI assistant trustworthiness
alter table products add column if not exists material_verified boolean default false;
