import { spawnSync } from "node:child_process";
import process from "node:process";

const sql = String.raw`
do $$
begin
  if exists (
    select 1 from public.products
    where sku like 'AUDIT-POS-%' or sku like 'AUDIT-INV-%' or sku like 'AUDIT-PRODUCT-%'
  ) then
    raise exception 'test products remain';
  end if;
  if exists (select 1 from public.sales_orders where idempotency_key like 'pos_sale:AUDIT-POS-%') then
    raise exception 'test orders remain';
  end if;
  if exists (
    select 1 from public.payments p join public.sales_orders o on o.id = p.order_id
    where o.idempotency_key like 'pos_sale:AUDIT-POS-%'
  ) then
    raise exception 'test payments remain';
  end if;
  if exists (
    select 1 from public.inventory_operations
    where operation_key like 'inventory:AUDIT-INV-%'
       or operation_key like 'quick_sell:AUDIT-INV-%'
       or operation_key like 'inventory:AUDIT-PRODUCT-%'
  ) then
    raise exception 'test inventory operations remain';
  end if;
  if exists (
    select 1 from public.product_operations
    where client_request_id like 'AUDIT-PRODUCT-%'
       or operation_key like '%AUDIT-PRODUCT-%'
  ) then
    raise exception 'test product operations remain';
  end if;
  if exists (
    select 1 from public.stock_movements
    where idempotency_key like '%AUDIT-POS-%'
       or idempotency_key like '%AUDIT-INV-%'
       or idempotency_key like '%AUDIT-PRODUCT-%'
  ) then
    raise exception 'test stock movements remain';
  end if;
  if exists (
    select 1 from public.admin_users
    where created_by in ('inventory-integration-test', 'developer-credential-integration-test')
       or email like 'inventory-owner-%@example.test'
       or email like 'developer-owner-%@example.test'
  ) then
    raise exception 'test administrators remain';
  end if;
  if exists (
    select 1 from auth.users
    where email like 'inventory-owner-%@example.test' or email like 'developer-owner-%@example.test'
  ) then
    raise exception 'test auth users remain';
  end if;
  if exists (select 1 from public.developer_access) then
    raise exception 'developer credential remains after tests';
  end if;
  if exists (
    select 1 from public.feature_settings
    where updated_by in (
      'pos-integration-test',
      'inventory-integration-test',
      'feature-gate-integration-test',
      'product-transaction-integration-test'
    )
  ) then
    raise exception 'feature settings were not restored';
  end if;
  if exists (
    select 1 from storage.objects
    where name like '%AUDIT-POS-%'
       or name like '%AUDIT-INV-%'
       or name like '%AUDIT-PRODUCT-%'
       or name like '%feature-gate-integration%'
  ) then
    raise exception 'test Storage objects remain';
  end if;
end
$$;
select 'P1 integration cleanup verified';
`;

const result = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_clothing_web", "psql", "-q", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);
if (result.status !== 0) {
  console.error("P1 integration cleanup check failed.");
  console.error(String(result.stderr || "").trim());
  process.exit(1);
}
console.log(String(result.stdout || "").trim());
