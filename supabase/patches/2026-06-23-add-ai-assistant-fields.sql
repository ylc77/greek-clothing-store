-- AI shopping assistant fields for existing client databases.
-- These fields are already included in supabase/client-init.sql for new clients.
alter table products add column if not exists size_chart jsonb default '{}'::jsonb;
alter table products add column if not exists fit_type text default 'regular';
alter table products add column if not exists style_tags text[] default '{}';
alter table products add column if not exists ai_keywords text[] default '{}';
