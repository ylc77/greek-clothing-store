-- Store image dimensions for Skroutz compliance checking
alter table products add column if not exists image_width int;
alter table products add column if not exists image_height int;
