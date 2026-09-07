"use client";

import { useCallback, useEffect, useState } from "react";

type Item = { variant_sku: string; name_en: string; name_gr: string; size: string; color: string; quantity: number; line_total: number };
type Shipment = { status: string; parcel_id: string | null; tracking_number: string | null; failure_code: string | null; provider_status: string | null; last_synced_at: string | null };
type Operation = { action: string; actor: string; previous_status: string | null; next_status: string | null; note: string | null; created_at: string };
type PaymentEvent = { event_type: string; status: string; failure_code: string | null; received_at: string; processed_at: string | null };
type Order = {
  id: string; order_number: string; status: string; fulfillment_status: string; fulfillment_method: string;
  payment_status: string; subtotal: number; shipping_total: number; total: number; customer_name: string;
  customer_email: string; customer_phone: string; customer_notes: string | null; created_at: string; paid_at: string | null;
  viva_order_code: string | null; viva_transaction_id: string | null; boxnow_locker_name: string | null;
  boxnow_locker_address: string | null; boxnow_locker_postal_code: string | null; pickup_code: string | null;
  pickup_expires_at: string | null; shipment: Shipment | null; items: Item[]; operations: Operation[]; payment_events: PaymentEvent[];
};

const statusLabels: Record<string, string> = {
  pending_payment: "待付款", paid: "已付款", packing: "准备中", ready_for_pickup: "可取货",
  shipped: "已交 BOX NOW", completed: "已完成", cancelled: "已取消", payment_failed: "付款失败",
  expired: "已过期", refunded: "已退款",
};
const paymentLabels: Record<string, string> = {
  pending: "待创建付款", payment_order_created: "等待付款", awaiting_confirmation: "确认中",
  paid: "已付款", failed: "失败", expired: "过期", cancelled: "取消", refunded: "退款",
  partially_refunded: "部分退款",
};
const fulfillmentLabels: Record<string, string> = {
  awaiting_payment: "等待付款", paid: "已付款待准备", packing: "准备中", ready_for_pickup: "可取货",
  shipment_pending: "待创建运单", shipment_created: "运单已创建", shipment_creation_failed: "运单创建失败",
  ready_for_handover: "待交接 BOX NOW", in_transit: "运输中", ready_at_locker: "已到 Locker", delivered: "已送达",
  returning: "退回途中", returned: "已退回", exception: "物流异常", picked_up: "已取货", completed: "已完成",
  cancelled: "已取消", expired: "付款已过期", pickup_overdue: "取货已超期（人工处理）", reconciliation_required: "需人工对账",
};

function masked(value: string | null) {
  if (!value) return "—";
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

import { adminVisibleMessage } from "@/lib/admin-navigation";

export function OnlineOrdersManager({ authHeaders, toast, showDiagnostics = false, onAfterSales }: { authHeaders: () => Record<string, string>; toast: (message: string, type?: "ok" | "err") => void; showDiagnostics?: boolean; onAfterSales?: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [healthIssues, setHealthIssues] = useState<string[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q: query, limit: "100" });
      const headers = authHeaders();
      const [response, healthResponse] = await Promise.all([
        fetch(`/api/admin/online-orders?${params}`, { headers }),
        fetch("/api/admin/online-orders/health", { headers, cache: "no-store" }),
      ]);
      const [data, health] = await Promise.all([response.json(), healthResponse.json().catch(() => ({}))]);
      if (!response.ok) throw new Error(data.error || "在线订单读取失败");
      setOrders(data.orders || []);
      setHealthIssues(Array.isArray(health.issues) ? health.issues.map(String) : healthResponse.ok ? [] : ["在线购物运行状态无法确认"]);
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "在线订单读取失败", showDiagnostics), "err"); }
    finally { setLoading(false); }
  }, [authHeaders, query, status, toast, showDiagnostics]);
  useEffect(() => { void load(); }, [load]);

  async function transition(order: Order, target: string) {
    const label = statusLabels[target] || target;
    if (!window.confirm(`确认将订单 ${order.order_number} 更新为“${label}”？`)) return;
    const note = window.prompt("操作备注（选填，最多 500 字）", "") || "";
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: target, operationId: crypto.randomUUID(), note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "更新失败");
      toast("在线订单状态已更新"); await load();
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "更新失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function cancelShipment(order: Order) {
    if (!window.confirm(`仅取消订单 ${order.order_number} 尚未交接的 BOX NOW 运单？订单和已付款库存预留不会被取消。`)) return;
    const note = window.prompt("取消原因或备注（选填）", "") || "";
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}/boxnow/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ operationId: crypto.randomUUID(), note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "取消运单失败");
      toast("BOX NOW 运单已取消，订单仍保留，可重新创建运单"); await load();
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "取消运单失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function extendPickup(order: Order) {
    const raw = window.prompt("从当前到期时间起延长几天？请输入 1–30", "3");
    if (raw == null) return;
    const days = Math.trunc(Number(raw));
    if (!Number.isInteger(days) || days < 1 || days > 30) { toast("请输入 1–30 天。", "err"); return; }
    const note = window.prompt("延长原因或备注（选填）", "") || "";
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}/extend-pickup`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ operationId: crypto.randomUUID(), days, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "延长取货时间失败");
      toast(`自提保留时间已延长 ${days} 天`); await load();
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "延长取货时间失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function createShipment(order: Order) {
    if (!window.confirm(`确认订单 ${order.order_number} 已完成打包，并创建一张 BOX NOW 运单？`)) return;
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}/boxnow/create-shipment`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ operationId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建运单失败");
      toast("BOX NOW 运单已创建"); await load();
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "创建运单失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function downloadLabel(order: Order) {
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}/boxnow/label`, { headers: authHeaders() });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "标签获取失败"); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `boxnow-${order.order_number}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "标签获取失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function refreshShipment(order: Order) {
    setBusyId(order.id);
    try {
      const response = await fetch(`/api/admin/online-orders/${order.id}/boxnow/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ operationId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "刷新物流状态失败");
      toast("BOX NOW 物流状态已刷新"); await load();
    } catch (error) { toast(adminVisibleMessage(error instanceof Error ? error.message : "刷新物流状态失败", showDiagnostics), "err"); }
    finally { setBusyId(""); }
  }
  async function copyPickupMessage(order: Order) {
    const expiry = order.pickup_expires_at ? new Date(order.pickup_expires_at).toLocaleString("el-GR") : "";
    const message = `Η παραγγελία σας ${order.order_number} είναι έτοιμη για παραλαβή από το κατάστημα. Κωδικός παραλαβής: ${order.pickup_code || "—"}.${expiry ? ` Παρακαλούμε παραλάβετε έως ${expiry}.` : ""}\n\nYour order ${order.order_number} is ready for store pickup. Pickup code: ${order.pickup_code || "—"}.${expiry ? ` Please collect by ${expiry}.` : ""}`;
    try { await navigator.clipboard.writeText(message); toast("希腊语/英语取货通知已复制，请人工发送给顾客。"); }
    catch { toast("无法复制通知，请检查浏览器剪贴板权限。", "err"); }
  }

  return <section className="space-y-5">
    {healthIssues.length ? <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800">{showDiagnostics ? `在线购物安全配置未完成，写入已阻断：${healthIssues.join("；")}` : "订单处理暂不可用，请联系负责人。"}</div> : null}
    <div className="admin-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="ui-kicker">Online orders</p><h2 className="mt-1 text-xl font-black">在线订单</h2><p className="mt-1 text-xs text-stone-500">管理已付款订单、门店自提和快递履约；付款状态以系统核验结果为准。</p></div><button className="admin-button-secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "刷新中…" : "刷新订单"}</button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_auto]"><input className="input" onChange={event => setQuery(event.target.value)} placeholder="订单号 / 姓名 / 电话" value={query}/><select className="input" onChange={event => setStatus(event.target.value)} value={status}><option value="all">全部状态</option><optgroup label="订单状态">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup><optgroup label="快捷处理"><option value="payment:awaiting_confirmation">付款待确认</option><option value="fulfillment:shipment_pending">BOX NOW 待建运单</option><option value="fulfillment:shipment_creation_failed">BOX NOW 建单失败</option><option value="fulfillment:paid">已付款待准备</option><option value="fulfillment:ready_for_pickup">自提可领取</option><option value="fulfillment:pickup_overdue">自提已超期</option><option value="fulfillment:reconciliation_required">人工对账</option></optgroup></select><button className="admin-button-primary" onClick={() => void load()} type="button">查询</button></div>
    </div>
    <div className="space-y-3">{orders.length === 0 ? <div className="admin-panel py-12 text-center text-sm font-bold text-stone-400">暂无在线订单。</div> : orders.map(order => <article className="admin-panel" key={order.id}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{order.order_number}</h3><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black">{statusLabels[order.status] || order.status}</span><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{order.fulfillment_method === "store_pickup" ? "门店自提" : "BOX NOW"}</span><span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">{paymentLabels[order.payment_status] || order.payment_status}</span></div><p className="mt-2 text-sm font-bold">{order.customer_name} · {order.customer_phone} · {order.customer_email}</p><p className="mt-1 text-xs text-stone-500">{order.fulfillment_method === "box_now" ? [order.boxnow_locker_name, order.boxnow_locker_address, order.boxnow_locker_postal_code].filter(Boolean).join(" · ") : `到店取货${order.pickup_code ? ` · 取货码 ${order.pickup_code}` : ""}`}</p><p className="mt-1 text-xs text-stone-400">{new Date(order.created_at).toLocaleString("zh-CN")}</p></div><p className="text-2xl font-black">€{Number(order.total).toFixed(2)}</p></div>
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4"><div className="rounded-xl bg-stone-50 p-3"><b>金额</b><span className="mt-1 block">商品 €{Number(order.subtotal).toFixed(2)} · 配送 €{Number(order.shipping_total).toFixed(2)}</span></div><div className="rounded-xl bg-stone-50 p-3"><b>履约</b><span className="mt-1 block">{fulfillmentLabels[order.fulfillment_status] || order.fulfillment_status}</span>{order.pickup_expires_at ? <span className="mt-1 block text-stone-500">取货截止 {new Date(order.pickup_expires_at).toLocaleString("zh-CN")}</span> : null}</div><div className="rounded-xl bg-stone-50 p-3"><b>Viva</b><span className="mt-1 block">订单 {masked(order.viva_order_code)} · 交易 {masked(order.viva_transaction_id)}</span></div><div className="rounded-xl bg-stone-50 p-3"><b>BOX NOW</b><span className="mt-1 block">{order.shipment ? `${order.shipment.status} · ${masked(order.shipment.tracking_number)}` : "尚未创建"}</span>{order.shipment?.failure_code ? <span className="mt-1 block text-red-600">{showDiagnostics ? order.shipment.failure_code : "运单处理失败，请联系负责人。"}</span> : null}</div></div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-stone-100"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-stone-50"><tr><th className="p-3">商品</th><th className="p-3">规格</th><th className="p-3">数量</th><th className="p-3 text-right">金额</th></tr></thead><tbody>{order.items.map(item => <tr className="border-t" key={item.variant_sku}><td className="p-3 font-bold">{item.name_gr || item.name_en}<br/><span className="font-mono text-[10px] text-stone-400">{item.variant_sku}</span></td><td className="p-3">{item.size}{item.color ? ` · ${item.color}` : ""}</td><td className="p-3">{item.quantity}</td><td className="p-3 text-right font-black">€{Number(item.line_total).toFixed(2)}</td></tr>)}</tbody></table></div>
      {order.customer_notes ? <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs">备注：{order.customer_notes}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {onAfterSales ? <button className="admin-button-secondary" onClick={onAfterSales} type="button">退货换货指引</button> : null}
        {order.status === "paid" ? <button className="admin-button-primary" disabled={busyId === order.id} onClick={() => void transition(order, "packing")} type="button">开始备货</button> : null}
        {order.status === "packing" && order.fulfillment_method === "store_pickup" ? <button className="admin-button-primary" disabled={busyId === order.id} onClick={() => void transition(order, "ready_for_pickup")} type="button">标记可取货</button> : null}
        {order.status === "ready_for_pickup" ? <button className="admin-button-secondary" onClick={() => void copyPickupMessage(order)} type="button">复制取货通知</button> : null}
        {order.status === "ready_for_pickup" && order.fulfillment_method === "store_pickup" ? <button className="admin-button-secondary" disabled={busyId === order.id} onClick={() => void extendPickup(order)} type="button">延长自提时间</button> : null}
        {order.payment_status === "paid" && order.fulfillment_method === "box_now" && (!order.shipment || order.shipment.status === "failed") ? <button className="admin-button-primary" disabled={busyId === order.id} onClick={() => void createShipment(order)} type="button">创建 BOX NOW 运单</button> : null}
        {order.shipment?.parcel_id ? <button className="admin-button-secondary" disabled={busyId === order.id} onClick={() => void downloadLabel(order)} type="button">下载运单标签</button> : null}
        {order.shipment?.parcel_id ? <button className="admin-button-secondary" disabled={busyId === order.id} onClick={() => void refreshShipment(order)} type="button">刷新物流状态</button> : null}
        {order.status === "packing" && ["created", "label_ready", "ready_for_handover"].includes(order.shipment?.status || "") ? <button className="admin-button-secondary text-red-600" disabled={busyId === order.id} onClick={() => void cancelShipment(order)} type="button">取消未交接运单</button> : null}
        {order.status === "packing" && order.fulfillment_method === "box_now" && ["created", "label_ready", "ready_for_handover"].includes(order.shipment?.status || "") ? <button className="admin-button-primary" disabled={busyId === order.id} onClick={() => void transition(order, "shipped")} type="button">标记已交 BOX NOW</button> : null}
        {order.status === "ready_for_pickup" || (order.status === "shipped" && ["in_transit", "ready_at_locker", "delivered"].includes(order.fulfillment_status)) ? <button className="admin-button-primary" disabled={busyId === order.id} onClick={() => void transition(order, "completed")} type="button">{order.fulfillment_method === "store_pickup" ? "确认已取货" : "确认已完成"}</button> : null}
        {["pending_payment", "payment_failed", "expired"].includes(order.status) ? <button className="admin-button-secondary text-red-600" disabled={busyId === order.id} onClick={() => void transition(order, "cancelled")} type="button">取消并释放预留</button> : null}
      </div>
      {showDiagnostics && (order.operations.length || order.payment_events.length) ? <details className="mt-4 rounded-2xl border border-stone-100 p-3 text-xs"><summary className="cursor-pointer font-black">操作与付款记录（{order.operations.length + order.payment_events.length}）</summary><div className="mt-3 grid gap-4 lg:grid-cols-2"><div><b>后台操作</b><div className="mt-2 space-y-2">{order.operations.length ? order.operations.map((item, index) => <div className="rounded-xl bg-stone-50 p-2" key={`${item.created_at}-${index}`}><span>{new Date(item.created_at).toLocaleString("zh-CN")} · {item.actor}</span><span className="block font-bold">{item.action}：{item.previous_status || "—"} → {item.next_status || "—"}</span>{item.note ? <span className="block text-stone-500">备注：{item.note}</span> : null}</div>) : <span className="text-stone-400">暂无记录</span>}</div></div><div><b>Viva 事件</b><div className="mt-2 space-y-2">{order.payment_events.length ? order.payment_events.map((item, index) => <div className="rounded-xl bg-stone-50 p-2" key={`${item.received_at}-${index}`}><span>{new Date(item.received_at).toLocaleString("zh-CN")}</span><span className="block font-bold">{item.event_type} · {item.status}</span>{item.failure_code ? <span className="block text-red-600">{item.failure_code}</span> : null}</div>) : <span className="text-stone-400">暂无记录</span>}</div></div></div></details> : null}
    </article>)}</div>
  </section>;
}
