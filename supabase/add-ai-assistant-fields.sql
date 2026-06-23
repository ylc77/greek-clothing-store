-- AI Shopping Assistant — optional fields for products
-- Add these to support size recommendations and semantic search
alter table products add column if not exists size_chart jsonb default '{}'::jsonb;
alter table products add column if not exists fit_type text default 'regular';
alter table products add column if not exists style_tags text[] default '{}';
alter table products add column if not exists ai_keywords text[] default '{}';
