"use client";

import { useMemo, useRef, useState } from "react";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { InventoryOperationIdStore } from "@/lib/inventory-operation-id";
import { parseInventoryReceiptInput, receiptRequestFingerprint } from "@/lib/inventory-receipt";
import type { QueueLabel } from "@/lib/operation-label-queue";
import type { Supplier } from "@/lib/types";

export type ReceivingInventoryItem = QueueLabel & {
  product_id: number;
  product_name_en?: string;
  product_name_gr?: string;
  category?: string;
  subcategory?: string;
  supplier_sku?: string | null;
  supplier_name?: string | null;
  supplier_style_code?: string | null;
  cost_price?: number | null;
  color: string | null;
  quantity_reserved: number;
  quantity_available: number;
};

type CartRow = { item: ReceivingInventoryItem; quantity: number; unitCost: string };
type Api = (path: string, init?: RequestInit) => Promise<any>;

export function InventoryReceivingWorkspace({
  api,
  suppliers,
  canViewCost,
  onCompleted,
}: {
  api: Api;
  suppliers: Supplier[];
  canViewCost: boolean;
  onCompleted: (result: { receiptId: string; receiptNumber: string; items: Array<Record<string, unknown>> }, labels: Array<{ label: QueueLabel; copies: number }>) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const operationStore = useRef<InventoryOperationIdStore | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReceivingInventoryItem[]>([]);
  const [cart, setCart] = useState<Map<string, CartRow>>(new Map());
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<Array<Record<string, any>>>([]);

  const rows = [...cart.values()];
  const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
  const missingBarcodes = rows.filter(row => !row.item.barcode?.trim()).length;

  function ids() {
    if (!operationStore.current) operationStore.current = new InventoryOperationIdStore("inventory-receipt", window.sessionStorage);
    return operationStore.current;
  }

  function add(item: ReceivingInventoryItem, increment = 1) {
    setCart(current => {
      const next = new Map(current);
      const existing = next.get(item.variant_id);
      next.set(item.variant_id, {
        item,
        quantity: Math.min(1_000_000, (existing?.quantity || 0) + increment),
        unitCost: existing?.unitCost || (canViewCost && item.cost_price != null ? String(item.cost_price) : ""),
      });
      return next;
    });
    setMessage(`${item.variant_sku} 已加入本次到货。`);
    setError("");
    setQuery("");
    setResults([]);
  }

  async function search(value = query, fromScanner = false) {
    const normalized = value.trim();
    if (!normalized) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await api(`/api/admin/inventory?q=${encodeURIComponent(normalized)}&limit=100`);
      const items = (Array.isArray(data.items) ? data.items : []) as ReceivingInventoryItem[];
      const exact = items.find(item => [item.barcode, item.variant_sku, item.supplier_sku]
        .some(candidate => candidate?.trim().toLowerCase() === normalized.toLowerCase()));
      if (exact) add(exact);
      else if (fromScanner) {
        setResults([]);
        setError(`未找到条码 ${normalized}。请先新增商品或拍照上新。`);
      }
      else if (items.length === 1) add(items[0]);
      else if (items.length) {
        setResults(items);
        setMessage(`找到 ${items.length} 个规格，请选择正确尺码和颜色。`);
      } else setError(fromScanner ? `未找到条码 ${normalized}。请先新增商品或拍照上新。` : "没有找到匹配的商品规格。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "到货商品查询失败。");
    } finally { setBusy(false); }
  }

  useBarcodeScanner({ active: !busy, inputRef, onScan: code => search(code, true) });

  function updateRow(variantId: string, update: Partial<Pick<CartRow, "quantity" | "unitCost">>) {
    setCart(current => {
      const next = new Map(current);
      const row = next.get(variantId);
      if (row) next.set(variantId, { ...row, ...update });
      return next;
    });
  }

  const input = useMemo(() => {
    try {
      return parseInventoryReceiptInput({
        clientRequestId: "preview",
        supplierId: supplierId || null,
        supplierReference: reference,
        notes,
        items: rows.map(row => ({
          variantId: row.item.variant_id,
          quantity: row.quantity,
          unitCost: canViewCost && row.unitCost !== "" ? Number(row.unitCost) : null,
        })),
      });
    } catch { return null; }
  }, [rows, supplierId, reference, notes, canViewCost]);

  async function complete() {
    if (!input) { setError("请检查到货数量和成本。每个数量必须是大于 0 的整数。"); return; }
    const submittedRows = new Map(rows.map(row => [row.item.variant_id, row]));
    const scope = "active";
    const fingerprint = receiptRequestFingerprint(input);
    let operationId = "";
    setBusy(true); setError(""); setMessage("正在核对服务端库存和规格...");
    try {
      const preview = await api("/api/admin/inventory/receipts/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setBusy(false);
      if (!window.confirm(`确认整批入库 ${preview.itemCount} 个规格、共 ${preview.totalUnits} 件？其中 ${preview.missingBarcodeCount} 个规格将生成内部条码。任一规格失败时整批不会写入。`)) {
        setMessage("已取消，本次到货清单尚未写入。");
        return;
      }
      setBusy(true);
      setMessage("正在保存本次到货...");
      operationId = ids().getOrCreate(scope, fingerprint);
      ids().markAttempt(scope, operationId);
      const result = await api("/api/admin/inventory/receipts", {
        method: "POST",
        body: JSON.stringify({ ...input, clientRequestId: operationId }),
      });
      const resultItems = (Array.isArray(result.items) ? result.items : []) as Array<Record<string, unknown>>;
      const labels = resultItems.reduce<Array<{ label: QueueLabel; copies: number }>>((collected, resultItem) => {
        const row = submittedRows.get(String(resultItem.variantId));
        if (row && typeof resultItem.barcode === "string" && resultItem.barcode) {
          collected.push({ label: { ...row.item, barcode: resultItem.barcode, quantity_on_hand: Number(resultItem.quantityAfter) }, copies: Number(resultItem.quantityReceived) });
        }
        return collected;
      }, []);
      ids().complete(scope, operationId);
      await onCompleted(result, labels);
      setCart(new Map()); setReference(""); setNotes("");
      setMessage(`到货单 ${result.receiptNumber} 已完成，共入库 ${result.totalUnits} 件。标签份数已按本次到货数量加入队列。`);
      await loadReceipts();
    } catch (cause) {
      const candidate = cause as Error & { operationSafeToDiscard?: boolean };
      if (operationId && candidate.operationSafeToDiscard) ids().discardKnownNoWrite(scope, operationId);
      setError(candidate.message || "本次到货结果暂时无法确认。请先查看到货历史，不要重复提交。");
    } finally { setBusy(false); }
  }

  async function loadReceipts() {
    try {
      const data = await api("/api/admin/inventory/receipts?limit=20");
      setReceipts(Array.isArray(data.receipts) ? data.receipts : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "到货历史加载失败。"); }
  }

  async function reprint(receiptId: string) {
    try {
      const data = await api(`/api/admin/inventory/receipts/${receiptId}`);
      const labels = (Array.isArray(data.items) ? data.items : []).map((item: Record<string, any>) => ({
        label: {
          variant_id: String(item.variant_id), barcode: String(item.barcode_snapshot),
          product_name: String(item.product_name_snapshot), product_sku: String(item.product_sku_snapshot),
          variant_sku: String(item.variant_sku_snapshot), size: item.size_snapshot || null,
          color: item.color_snapshot || null, price: Number(item.price_snapshot),
          quantity_on_hand: Number(item.quantity_after), active: true,
        },
        copies: Number(item.quantity_received),
      }));
      await onCompleted({ receiptId, receiptNumber: String(data.receipt.receipt_number), items: data.items }, labels);
      setMessage(`到货单 ${data.receipt.receipt_number} 已重新加入标签队列。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "补打标签加载失败。"); }
  }

  return <section className="admin-panel" data-inventory-receiving-workspace>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">到货清单</p><h2 className="mt-1 text-xl font-black text-ink">整批到货入库</h2><p className="mt-1 text-xs leading-5 text-stone-500">连续扫码加入商品，核对每个规格的到货数量后统一保存。保存成功即可打印本次标签。</p></div>
      <button className="admin-button-secondary" disabled={busy} type="button" onClick={() => void loadReceipts()}>到货历史 / 补打</button>
    </div>
    <form className="mt-5 flex gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
      <input ref={inputRef} autoFocus autoComplete="off" className="input min-h-12 flex-1" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} placeholder="连续扫描条码，或搜索 SKU / 供货商 SKU / 商品名" />
      <button className="admin-button-primary" disabled={busy} type="submit">查找</button>
    </form>
    {error ? <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
    {message ? <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" role="status">{message}</p> : null}
    {results.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{results.map(item => <button key={item.variant_id} disabled={busy} type="button" onClick={() => add(item)} className="rounded-xl border border-stone-200 p-3 text-left hover:border-stone-500"><b>{item.product_name}</b><small className="mt-1 block text-stone-500">{item.variant_sku} · {item.color || "默认色"} · {item.size || "ONE SIZE"}</small></button>)}</div> : null}

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
      <div className="overflow-hidden rounded-2xl border border-stone-200">
        <div className="flex justify-between bg-stone-50 px-4 py-3"><b>本次到货清单</b><span>{rows.length} 个规格 / {totalUnits} 件</span></div>
        {!rows.length ? <p className="p-8 text-center text-sm text-stone-500">扫描或搜索后，把不同尺码和颜色连续加入这里。</p> : <ul className="divide-y divide-stone-200">{rows.map(row => <li key={row.item.variant_id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto] sm:items-center">
          <div><b>{row.item.product_name}</b><small className="block text-stone-500">{row.item.variant_sku} · {row.item.color || "默认色"} · {row.item.size || "ONE SIZE"}{!row.item.barcode ? " · 将生成条码" : ""}</small></div>
          <label className="text-xs font-bold">到货数量<input className="input mt-1" disabled={busy} min={1} step={1} type="number" value={row.quantity} onChange={event => updateRow(row.item.variant_id, { quantity: Number(event.target.value) })} /></label>
          {canViewCost ? <label className="text-xs font-bold">单件成本<input className="input mt-1" disabled={busy} min={0} step="0.01" type="number" value={row.unitCost} onChange={event => updateRow(row.item.variant_id, { unitCost: event.target.value })} /></label> : <span />}
          <button className="admin-button-secondary" disabled={busy} type="button" onClick={() => setCart(current => { const next = new Map(current); next.delete(row.item.variant_id); return next; })}>移除</button>
        </li>)}</ul>}
      </div>
      <aside className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <label className="block text-xs font-black">供货商（选填）<select className="input mt-1" disabled={busy} value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">未指定</option>{suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label className="mt-3 block text-xs font-black">送货单号（选填）<input className="input mt-1" disabled={busy} maxLength={160} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <label className="mt-3 block text-xs font-black">备注（选填）<textarea className="input mt-1 min-h-20" disabled={busy} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <div className="mt-4 rounded-xl bg-white p-3 text-sm"><p>规格：<b>{rows.length}</b></p><p>总件数：<b>{totalUnits}</b></p><p>将生成条码：<b>{missingBarcodes}</b></p><p>预计标签：<b>{totalUnits}</b> 张</p></div>
        <button className="admin-button-primary mt-4 w-full" disabled={busy || !input} type="button" onClick={() => void complete()}>{busy ? "处理中..." : "确认整批入库"}</button>
      </aside>
    </div>
    {receipts.length ? <div className="mt-6"><h3 className="font-black">最近到货单</h3><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">单号</th><th className="p-2">时间</th><th className="p-2">件数</th><th className="p-2">操作</th></tr></thead><tbody>{receipts.map(receipt => <tr className="border-t" key={receipt.id}><td className="p-2 font-mono">{receipt.receipt_number}</td><td className="p-2">{new Date(receipt.received_at).toLocaleString()}</td><td className="p-2">{receipt.total_units}</td><td className="p-2"><button className="admin-button-secondary" disabled={busy} type="button" onClick={() => void reprint(String(receipt.id))}>按原数量补打</button></td></tr>)}</tbody></table></div></div> : null}
  </section>;
}
