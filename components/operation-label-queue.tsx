"use client";
import type { LabelQueueAction, LabelQueueEntry } from "@/lib/operation-label-queue";

export function OperationLabelQueue({ entries, total, revision, confirmedPrinted, dispatch, onPrint }: {
  entries: LabelQueueEntry[]; total: number; revision: number; confirmedPrinted: number; dispatch: (action: LabelQueueAction) => void; onPrint: () => void;
}) {
  if (!entries.length) return confirmedPrinted ? <p role="status" className="admin-panel my-4 text-sm" data-label-print-confirmation>本次会话已由操作员确认打印 {confirmedPrinted} 张。此记录只在当前页面保存，不代表打印机自动检测，也不改变库存。</p> : null;
  return <details className="admin-panel my-4" open data-operation-label-queue>
    <summary className="font-bold">本次作业标签 · {entries.length} 个规格 / {total} 张</summary>
    <p className="my-3 text-sm text-stone-600">份数来自本次入库，不是当前总库存。关闭打印窗口不代表打印成功；请核对实物后确认。刷新或退出将丢失此队列。</p>
    <ul className="space-y-2">{entries.map(({ label, copies, sources }) => <li key={label.variant_id} className="flex flex-wrap items-center gap-3 border-b py-2">
      <span className="min-w-0 flex-1 break-words">{label.product_name} · {label.color} {label.size}<small className="block text-stone-500">{sources.join("、")} · {label.barcode}</small></span>
      <label className="text-sm">份数 <input aria-label={`${label.variant_sku} 打印份数`} className="input w-24" type="number" min={1} max={1000000} value={copies} onChange={e => dispatch({ type: "copies", variantId: label.variant_id, copies: Number(e.target.value) })} /></label>
      <button type="button" className="admin-button-secondary" onClick={() => dispatch({ type: "remove", variantId: label.variant_id })}>移除</button>
    </li>)}</ul>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="admin-button-primary" onClick={onPrint}>打印本次标签</button>
      <button type="button" className="admin-button-secondary" onClick={() => { if (window.confirm(`请核对实际输出：当前 ${total} 张标签均已正确打印？确认后移出待打印队列，不改变库存。`)) dispatch({ type: "confirmPrinted", revision }); }}>确认实物已打印</button>
      <button type="button" className="admin-button-secondary" onClick={() => { if (window.confirm("放弃当前待打印标签？这不会标记打印成功，也不会改变库存。")) dispatch({ type: "clear" }); }}>清空队列</button>
    </div>
  </details>;
}
