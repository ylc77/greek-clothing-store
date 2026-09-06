import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("checkout is Viva RPC-only and does not restore legacy COD creation", () => {
  const route = read("app/api/orders/route.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(route, /online_checkout_prepare_rpc/);
  assert.match(route, /online_checkout_bind_viva_rpc/);
  assert.doesNotMatch(route, /online_order_create_rpc/);
  assert.match(migration, /revoke execute on function public\.online_order_create_rpc[\s\S]*from service_role/);
  assert.match(migration, /p_fulfillment_method not in \('box_now', 'store_pickup'\)/);
});

test("Viva return pages never act as payment proof", () => {
  const returnPage = read("components/checkout-return-client.tsx");
  const webhook = read("app/api/webhooks/viva/route.ts");
  assert.doesNotMatch(returnPage, /online_payment_confirm_rpc|SUPABASE_SERVICE_ROLE_KEY|createServerSupabaseClient/);
  assert.match(webhook, /retrieveVivaTransaction/);
  assert.match(webhook, /online_payment_confirm_rpc/);
  assert.match(webhook, /verified\.statusId === "F"/);
  assert.match(webhook, /verified\.amountCents === event\.amountCents/);
  assert.match(webhook, /verified\.sourceCode === config\.sourceCode/);
});

test("private payment and shipment ledgers are RLS protected and service-role only", () => {
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  for (const table of ["online_payment_attempts", "online_payment_events", "online_shipments", "product_fulfillment_operations"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
});

test("expiry maintenance fails closed and never auto-cancels paid overdue pickups", () => {
  const cron = read("app/api/cron/online-orders/route.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /timingSafeEqual/);
  assert.match(cron, /online_order_expire_pending_rpc/);
  assert.match(migration, /payment_status='paid'[\s\S]*fulfillment_status='ready_for_pickup'/);
  assert.match(migration, /set fulfillment_status='pickup_overdue'/);
  assert.doesNotMatch(migration, /set status='cancelled'[^;]*pickup_overdue/);
});

test("checkout replay cannot regress paid state and late payment checks reserved stock", () => {
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(migration, /response-loss retry[\s\S]*Never regress a committed checkout back to pending state/);
  assert.match(migration, /coalesce\(\(v_result ->> 'replayed'\)::boolean, false\)[\s\S]*return app_private\.online_order_payload\(v_order_id,true\)/);
  assert.match(migration, /coalesce\(b\.quantity_reserved,0\)<i\.quantity/);
  assert.match(migration, /INSUFFICIENT_RESERVED_STOCK/);
  assert.match(migration, /fulfillment_status='reconciliation_required'/);
});

test("storefront uses the official BOX NOW v5 widget contract", () => {
  const widget = read("components/boxnow-locker-selector.tsx");
  assert.match(widget, /widget-cdn\.boxnow\.gr\/map-widget\/client\/v5\.js/);
  assert.match(widget, /_bn_map_widget_config/);
  assert.match(widget, /afterSelect/);
  assert.match(widget, /NEXT_PUBLIC_BOXNOW_PARTNER_ID/);
});

test("pickup-only fulfillment is present in the public product contract without exposing package internals", () => {
  const boundary = read("lib/product-data-boundary.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(boundary, /PUBLIC_PRODUCT_LIST_COLUMNS[\s\S]*"fulfillment_profile"/);
  assert.match(boundary, /PUBLIC_PRODUCT_DETAIL_COLUMNS[\s\S]*"fulfillment_profile"/);
  assert.match(migration, /grant select \(fulfillment_profile\) on table public\.products to anon, authenticated/);
  assert.doesNotMatch(boundary.match(/PUBLIC_PRODUCT_LIST_COLUMNS[\s\S]*?\] as const;/)?.[0] || "", /package_weight_grams|shipping_note_zh/);
  assert.match(migration, /create or replace function public\.product_checkout_variants_batch_rpc\(p_product_skus text\[\]\)/);
  assert.match(migration, /revoke all on function public\.product_checkout_variants_batch_rpc\(text\[\]\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.product_checkout_variants_batch_rpc\(text\[\]\) to service_role/);
});

test("admin runtime health checks configuration and transactional database capabilities", () => {
  const route = read("app/api/admin/online-orders/health/route.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(route, /authorizeAdminRequest\(request, "online_orders:read"\)/);
  assert.match(route, /USE_ONLINE_ORDER_RPC/);
  assert.match(route, /getVivaConfig/);
  assert.match(route, /getBoxNowConfig/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /online_commerce_runtime_health_rpc/);
  assert.match(migration, /online_shipment_complete_rpc\(uuid,text,text,text,text,boolean\)/);
  assert.doesNotMatch(migration, /online_shipment_complete_rpc\(uuid,text,text,text,text,text,boolean\)/);
  assert.match(migration, /'shipmentCancelRpc'/);
  assert.match(migration, /'pickupExtensionRpc'/);
  assert.match(migration, /revoke all on function public\.online_commerce_runtime_health_rpc\(\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.online_commerce_runtime_health_rpc\(\) to service_role/);
});

test("BOX NOW cancellation is administrator-only, two-phase, and never releases paid inventory", () => {
  const route = read("app/api/admin/online-orders/[id]/boxnow/cancel/route.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(route, /authorizeAdminRequest\(request, "online_orders:write"\)/);
  assert.match(route, /online_shipment_cancel_prepare_rpc/);
  assert.match(route, /cancelBoxNowParcel/);
  assert.match(route, /online_shipment_cancel_complete_rpc/);
  assert.match(migration, /create or replace function public\.online_shipment_cancel_prepare_rpc/);
  assert.match(migration, /create or replace function public\.online_shipment_cancel_complete_rpc/);
  assert.match(migration, /set status='packing',fulfillment_status='shipment_pending'/);
  const cancelBlock = migration.slice(migration.indexOf("create or replace function public.online_shipment_cancel_prepare_rpc"), migration.indexOf("drop function if exists public.online_order_transition_rpc"));
  assert.doesNotMatch(cancelBlock, /quantity_reserved\s*=|movement_type/);
});

test("pickup extensions and transitions preserve actor and before-after audit fields", () => {
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(migration, /add column if not exists previous_status text/);
  assert.match(migration, /create or replace function public\.online_order_extend_pickup_rpc/);
  assert.match(migration, /previous_status,next_status,note/);
  assert.match(migration, /fulfillment_status='ready_for_pickup'/);
});

test("BOX NOW refresh uses the documented provider state set and blocks unsafe completion", () => {
  const route = read("app/api/admin/online-orders/[id]/boxnow/refresh/route.ts");
  const migration = read("supabase/migrations/20260820121706_viva_boxnow_online_checkout.sql");
  assert.match(route, /authorizeAdminRequest\(request, "online_orders:write"\)/);
  assert.match(route, /fetchBoxNowParcelState/);
  assert.match(route, /online_shipment_refresh_rpc/);
  assert.match(migration, /create or replace function public\.online_shipment_refresh_rpc/);
  assert.match(migration, /provider_status=p_provider_state,last_synced_at=/);
  assert.match(migration, /fulfillment_status in \('in_transit','ready_at_locker','delivered'\)/);
});
