"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { calculateReturnExchangeAmounts, posReturnRequestFingerprint, type ReturnCondition } from "@/lib/pos-return";
import { PosOperationIdStore } from "@/lib/pos-operation-id";

type Api = (path: string, init?: RequestInit) => Promise<any>;
type OrderItem = { id: string; variant_id: string; product_sku: string; variant_sku: string; barcode: string | null; name: string; size: string | null; color: string | null; quantity: number; line_total: number };
type Order = { id: string; order_number: string; status: string; currency?: string; created_at: string };
type SearchItem = { variant_id: string; product_id: number; product_sku: string; variant_sku: string; barcode: string | null; product_name: string; size: string | null; color: string | null; price: number; quantity_available: number };
type ReturnSelection = { quantity: number; condition: ReturnCondition };
type ExchangeSelection = { item: SearchItem; quantity: number };

const conditionLabels: Record<ReturnCondition, string> = { resellable: "可再次销售", damaged: "瑕疵 / 损坏", quarantine: "隔离待检查" };

export function PosReturnExchangeDialog({ api, order, items, onClose, onCompleted }: {
  api: Api;
  order: Order;
  items: OrderItem[];
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const operationIds = useRef<PosOperationIdStore | null>(null);
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [returns, setReturns] = useState<Map<string, ReturnSelection>>(new Map());
  const [exchanges, setExchanges] = useState<Map<string, ExchangeSelection>>(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [reason, setReason] = useState("");
  const [externalMethod, setExternalMethod] = useState<"cash" | "card" | "other" | "">("");
  const [externalReference, setExternalReference] = useState("");
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Record<string, any> | null>(null);

  const previousByItem = useMemo(() => {
    const result = new Map<string, { quantity: number; amount: number }>();
    for (const entry of history) for (const line of Array.isArray(entry.sales_return_items) ? entry.sales_return_items : []) {
      const key = String(line.original_order_item_id);
      const current = result.get(key) || { quantity: 0, amount: 0 };
      result.set(key, { quantity: current.quantity + Number(line.quantity || 0), amount: current.amount + Number(line.return_amount || 0) });
    }
    return result;
  }, [history]);

  const amounts = useMemo(() => calculateReturnExchangeAmounts(
    [...returns].map(([id, selection]) => {
      const item = items.find(candidate => candidate.id === id)!;
      const previous = previousByItem.get(id) || { quantity: 0, amount: 0 };
      return { lineTotal: Number(item.line_total), soldQuantity: item.quantity, previousQuantity: previous.quantity, previousAmount: previous.amount, quantity: selection.quantity };
    }),
    [...exchanges.values()].map(row => ({ unitPrice: Number(row.item.price), quantity: row.quantity })),
  ), [returns, exchanges, items, previousByItem]);

  const needsExternal = amounts.balanceDelta !== 0;
  const returnCount = [...returns.values()].reduce((sum, row) => sum + row.quantity, 0);
  const exchangeCount = [...exchanges.values()].reduce((sum, row) => sum + row.quantity, 0);

  function ids() {
    if (!operationIds.current) operationIds.current = new PosOperationIdStore(window.sessionStorage);
    return operationIds.current;
  }

  async function loadHistory() {
    try {
      const data = await api(`/api/admin/pos/orders/${order.id}/returns`);
      setHistory(Array.isArray(data.returns) ? data.returns : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "退换货记录读取失败。"); }
  }
  useEffect(() => { void loadHistory(); }, [order.id]);

  function selectReturn(item: OrderItem, enabled: boolean) {
    setReturns(current => {
      const next = new Map(current);
      if (!enabled) next.delete(item.id);
      else next.set(item.id, { quantity: 1, condition: "resellable" });
      return next;
    });
  }

  async function search(value = query, fromScanner = false) {
    const normalized = value.trim(); if (!normalized) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await api(`/api/admin/pos/search?q=${encodeURIComponent(normalized)}`);
      const candidates = (Array.isArray(data.items) ? data.items : []) as SearchItem[];
      const exact = candidates.find(item => [item.barcode, item.variant_sku].some(code => code?.toLowerCase() === normalized.toLowerCase()));
      if (exact) addExchange(exact);
      else if (fromScanner) setError(`未找到换出条码 ${normalized}。`);
      else if (candidates.length === 1) addExchange(candidates[0]);
      else { setResults(candidates); setMessage(candidates.length ? `找到 ${candidates.length} 个规格，请选择。` : "没有找到可换出的商品规格。"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "换出商品查询失败。"); }
    finally { setBusy(false); }
  }
  useBarcodeScanner({ active: !busy && !receipt, inputRef: searchRef, onScan: code => search(code, true) });

  function addExchange(item: SearchItem) {
    if (Number(item.quantity_available) <= 0) { setError(`${item.variant_sku} 当前无可用库存。`); return; }
    setExchanges(current => {
      const next = new Map(current); const existing = next.get(item.variant_id);
      next.set(item.variant_id, { item, quantity: Math.min(Number(item.quantity_available), (existing?.quantity || 0) + 1) });
      return next;
    });
    setQuery(""); setResults([]); setMessage(`${item.variant_sku} 已加入换出清单。`); setError("");
  }

  async function submit() {
    if (!returns.size) { setError("请至少选择一条原订单商品。"); return; }
    if (reason.trim().length < 3) { setError("请填写至少 3 个字符的退货或换货原因。"); return; }
    if (needsExternal && (!externalConfirmed || !externalMethod || !externalReference.trim())) {
      setError(`请先在外部收银机完成${amounts.balanceDelta > 0 ? "补收" : "退款"}，再填写方式、参考号并勾选确认。`); return;
    }
    if (!window.confirm(`确认提交？退入 ${returnCount} 件，换出 ${exchangeCount} 件，${amounts.balanceDelta > 0 ? `应补收 €${amounts.balanceDelta.toFixed(2)}` : amounts.balanceDelta < 0 ? `应退款 €${Math.abs(amounts.balanceDelta).toFixed(2)}` : "无金额差额"}。任一库存或记录失败时整笔回滚。`)) return;
    const withoutId = {
      returnItems: [...returns].map(([orderItemId, row]) => ({ orderItemId, ...row })),
      exchangeItems: [...exchanges].map(([variantId, row]) => ({ variantId, quantity: row.quantity })),
      reason: reason.trim(),
      externalConfirmation: { confirmed: needsExternal ? externalConfirmed : false, method: needsExternal ? externalMethod : "" as const, reference: needsExternal ? externalReference.trim() : "", expectedBalanceDelta: amounts.balanceDelta },
    };
    const scope = `return:${order.id}`;
    const fingerprint = posReturnRequestFingerprint(withoutId);
    const operationId = ids().getOrCreate(scope, fingerprint);
    setBusy(true); setError(""); setMessage("正在处理所选商品...");
    try {
      const data = await api(`/api/admin/pos/orders/${order.id}/returns`, { method: "POST", body: JSON.stringify({ ...withoutId, clientRequestId: operationId }) });
      ids().complete(scope, operationId); setReceipt(data); setMessage(data.alreadyProcessed ? "该业务已处理，已返回原退换货结果。" : "退换货已完成。");
      await loadHistory(); await onCompleted();
    } catch (cause) {
      const candidate = cause as Error & { operationSafeToDiscard?: boolean };
      if (candidate.operationSafeToDiscard) ids().cancel(scope);
      setError(candidate.message || "退换货结果暂时无法确认。请先查看订单记录，不要重复提交。");
    } finally { setBusy(false); }
  }

  if (receipt) {
    const result = receipt.return || {};
    return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <style>{`@media print{body *{visibility:hidden!important}.pos-return-receipt,.pos-return-receipt *{visibility:visible!important}.pos-return-receipt{position:absolute!important;left:0;top:0;width:80mm}.pos-return-no-print{display:none!important}@page{margin:4mm}}`}</style>
      <div className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-paper p-5 sm:rounded-3xl">
        <div className="pos-return-no-print flex justify-between gap-3"><div><h3 className="text-xl font-black">退换货已完成</h3><p className="text-xs text-stone-500">可打印内部凭据；它不是 AADE 税务票据。</p></div><button className="admin-button-secondary" onClick={onClose}>关闭</button></div>
        <article className="pos-return-receipt mx-auto mt-5 w-[80mm] bg-white p-5 font-mono text-xs shadow-sm">
          <h1 className="text-center text-base font-black">内部退换货凭据</h1><p className="mt-1 text-center font-bold">不是 AADE 税务票据</p><hr className="my-3 border-dashed" />
          <p>原订单：{order.order_number}</p><p>退货单：{result.return_number}</p><p>原因：{result.reason}</p>
          <hr className="my-3 border-dashed" /><p>退入：€{Number(result.return_subtotal || 0).toFixed(2)}</p><p>换出：€{Number(result.exchange_subtotal || 0).toFixed(2)}</p><p className="font-black">差额：€{Number(result.balance_delta || 0).toFixed(2)}</p>
          {result.external_action !== "none" ? <p>外部处理：{result.external_action} / {result.external_method} / {result.external_reference}</p> : null}
        </article>
        <button className="pos-return-no-print admin-button-primary mt-4 w-full" type="button" onClick={() => window.print()}>打印内部凭据</button>
      </div>
    </div>;
  }

  return <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
    <div className="max-h-[96dvh] w-full max-w-6xl overflow-y-auto rounded-t-3xl bg-paper p-5 sm:rounded-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[.18em] text-stone-400">订单售后</p><h3 className="text-xl font-black">退货与换货 · {order.order_number}</h3><p className="mt-1 text-xs text-stone-500">选择需要退回或换出的商品并确认数量；整单作废请返回订单详情操作。</p></div><button className="admin-button-secondary" disabled={busy} onClick={onClose}>关闭</button></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4"><h4 className="font-black">1. 选择退入商品</h4><div className="mt-3 space-y-3">{items.map(item => {
          const previous = previousByItem.get(item.id)?.quantity || 0; const remaining = Math.max(0, item.quantity - previous); const selected = returns.get(item.id);
          return <div className="rounded-xl border p-3" key={item.id}><label className="flex gap-3"><input checked={Boolean(selected)} disabled={!remaining || busy} type="checkbox" onChange={event => selectReturn(item, event.target.checked)} /><span><b>{item.name}</b><small className="block text-stone-500">{item.variant_sku} · {item.size || "ONE SIZE"} · {item.color || "默认色"} · 可退 {remaining}/{item.quantity}</small></span></label>{selected ? <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs font-bold">数量<input className="input mt-1" max={remaining} min={1} type="number" value={selected.quantity} onChange={event => setReturns(current => new Map(current).set(item.id, { ...selected, quantity: Math.max(1, Math.min(remaining, Number(event.target.value) || 1)) }))} /></label><label className="text-xs font-bold">商品状态<select className="input mt-1" value={selected.condition} onChange={event => setReturns(current => new Map(current).set(item.id, { ...selected, condition: event.target.value as ReturnCondition }))}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div> : null}</div>;
        })}</div></section>
        <section className="rounded-2xl border bg-white p-4"><h4 className="font-black">2. 可选：扫描换出商品</h4><form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); void search(); }}><input ref={searchRef} className="input flex-1" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="扫描 Barcode 或搜索 SKU / 商品名" /><button className="admin-button-secondary" disabled={busy}>查找</button></form>{results.length ? <div className="mt-2 space-y-2">{results.map(item => <button className="w-full rounded-xl border p-3 text-left" key={item.variant_id} onClick={() => addExchange(item)} type="button"><b>{item.product_name}</b><small className="block">{item.variant_sku} · 可用 {item.quantity_available}</small></button>)}</div> : null}<div className="mt-3 space-y-2">{[...exchanges.values()].map(row => <div className="flex items-center gap-2 rounded-xl bg-stone-50 p-3" key={row.item.variant_id}><span className="min-w-0 flex-1"><b>{row.item.product_name}</b><small className="block text-stone-500">{row.item.variant_sku} · €{Number(row.item.price).toFixed(2)}</small></span><input className="input w-20" max={row.item.quantity_available} min={1} type="number" value={row.quantity} onChange={event => setExchanges(current => new Map(current).set(row.item.variant_id, { ...row, quantity: Math.max(1, Math.min(row.item.quantity_available, Number(event.target.value) || 1)) }))} /><button className="admin-button-secondary" onClick={() => setExchanges(current => { const next = new Map(current); next.delete(row.item.variant_id); return next; })}>移除</button></div>)}</div></section>
      </div>
      <section className="mt-5 rounded-2xl border bg-white p-4"><h4 className="font-black">3. 核对金额与外部处理</h4><div className="mt-3 grid gap-3 sm:grid-cols-3"><p className="rounded-xl bg-stone-50 p-3">退入金额<br/><b>€{amounts.returnSubtotal.toFixed(2)}</b></p><p className="rounded-xl bg-stone-50 p-3">换出金额<br/><b>€{amounts.exchangeSubtotal.toFixed(2)}</b></p><p className="rounded-xl bg-stone-50 p-3">{amounts.balanceDelta > 0 ? "应补收" : amounts.balanceDelta < 0 ? "应退款" : "无需补退"}<br/><b>€{Math.abs(amounts.balanceDelta).toFixed(2)}</b></p></div><label className="mt-3 block text-xs font-black">退换货原因<textarea className="input mt-1 min-h-20" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>{needsExternal ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs font-black">外部处理方式<select className="input mt-1" value={externalMethod} onChange={event => setExternalMethod(event.target.value as typeof externalMethod)}><option value="">请选择</option><option value="cash">现金</option><option value="card">银行卡 / POS</option><option value="other">其他</option></select></label><label className="text-xs font-black">外部参考号<input className="input mt-1" maxLength={200} value={externalReference} onChange={event => setExternalReference(event.target.value)} /></label><label className="sm:col-span-2 flex gap-2 text-sm font-bold"><input checked={externalConfirmed} type="checkbox" onChange={event => setExternalConfirmed(event.target.checked)} />我已在真实收银机或支付渠道完成对应的{amounts.balanceDelta > 0 ? "补收" : "退款"}</label></div> : <p className="mt-3 text-sm font-bold text-emerald-700">金额相同，不需要外部补收或退款。</p>}</section>
      {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}{message ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{message}</p> : null}
      <button className="admin-button-primary mt-4 w-full" disabled={busy || !returns.size} onClick={() => void submit()} type="button">{busy ? "处理中..." : "确认退货 / 换货"}</button>
    </div>
  </div>;
}
