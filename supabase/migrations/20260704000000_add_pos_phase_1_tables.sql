begin;

create extension if not exists pgcrypto;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  status text not null default 'completed',
  source text not null default 'pos',
  subtotal numeric(10,2) not null default 0,
  discount_total numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  currency text not null default 'EUR',
  payment_status text not null default 'paid',
  idempotency_key text not null,
  created_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  voided_at timestamptz,
  refunded_at timestamptz,
  constraint sales_orders_order_number_unique unique (order_number),
  constraint sales_orders_idempotency_key_unique unique (idempotency_key),
  constraint sales_orders_status_check
    check (status in ('completed', 'voided', 'refunded')),
  constraint sales_orders_source_check
    check (source in ('pos', 'manual')),
  constraint sales_orders_payment_status_check
    check (payment_status in ('paid', 'voided', 'refunded')),
  constraint sales_orders_amounts_check
    check (
      subtotal >= 0
      and discount_total >= 0
      and total >= 0
    )
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_sku text not null,
  variant_sku text not null,
  barcode text,
  name text not null,
  size text,
  color text,
  quantity integer not null,
  unit_price numeric(10,2) not null,
  discount_total numeric(10,2) not null default 0,
  line_total numeric(10,2) not null,
  created_at timestamptz not null default now(),
  constraint sales_order_items_quantity_check
    check (quantity > 0),
  constraint sales_order_items_amounts_check
    check (
      unit_price >= 0
      and discount_total >= 0
      and line_total >= 0
    )
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id) on delete restrict,
  method text not null,
  amount numeric(10,2) not null,
  currency text not null default 'EUR',
  status text not null default 'paid',
  provider text,
  provider_reference text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  constraint payments_method_check
    check (method in ('cash', 'card', 'other')),
  constraint payments_status_check
    check (status in ('paid', 'failed', 'refunded', 'voided')),
  constraint payments_amount_check
    check (amount >= 0)
);

create index if not exists sales_orders_created_at_idx
on public.sales_orders(created_at desc);

create index if not exists sales_orders_status_idx
on public.sales_orders(status);

create index if not exists sales_order_items_order_id_idx
on public.sales_order_items(order_id);

create index if not exists sales_order_items_product_id_idx
on public.sales_order_items(product_id);

create index if not exists sales_order_items_variant_id_idx
on public.sales_order_items(variant_id);

create index if not exists sales_order_items_variant_sku_idx
on public.sales_order_items(variant_sku);

create index if not exists payments_order_id_idx
on public.payments(order_id);

create index if not exists payments_method_idx
on public.payments(method);

create index if not exists payments_created_at_idx
on public.payments(created_at desc);

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.payments enable row level security;

revoke all on table public.sales_orders from anon, authenticated;
revoke all on table public.sales_order_items from anon, authenticated;
revoke all on table public.payments from anon, authenticated;

grant select, insert, update, delete on table public.sales_orders to service_role;
grant select, insert, update, delete on table public.sales_order_items to service_role;
grant select, insert, update, delete on table public.payments to service_role;

commit;
