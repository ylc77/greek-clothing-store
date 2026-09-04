"use client";

import type { AdminNavigationTab } from "@/lib/admin-navigation";
export function WorkspacePage({ actions, onSelect, stats }: {
  actions: readonly { view: AdminNavigationTab; label: string; mode?: "receiving" | "stocktake" }[];
  onSelect: (view: AdminNavigationTab, mode?: "receiving" | "stocktake") => void;
  stats: { total: number; active: number; noStock: number } | null;
}) {
  return <section className="admin-panel" data-admin-workspace>
    <h2 className="text-xl font-black">工作台</h2><p className="mt-2 text-sm text-stone-500">从常用操作开始，处理今天的门店工作。</p>
    <div className="my-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{actions.map(action => <button type="button" data-workspace-action={action.view} key={`${action.view}-${action.mode || ""}`} onClick={() => onSelect(action.view, action.mode)} className="min-h-24 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-left font-bold hover:border-stone-400 focus-visible:outline focus-visible:outline-2">{action.label}<span aria-hidden="true" className="float-right">→</span></button>)}</div>
    {stats ? <div className="grid grid-cols-3 gap-3">{[{ label: "当前商品", value: stats.total }, { label: "已上架", value: stats.active }, { label: "无库存", value: stats.noStock }].map(item => <div key={item.label} className="rounded-xl bg-stone-50 p-4"><p className="text-2xl font-black">{item.value}</p><p className="mt-1 text-xs text-stone-500">{item.label}</p></div>)}</div> : null}
  </section>;
}
