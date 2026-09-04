"use client";

import { LayoutDashboard, ScanLine, PackagePlus, Boxes, ReceiptText, Settings2 } from "lucide-react";
import type { AdminPrimaryKey } from "@/lib/admin-navigation";

const icons = { workspace: LayoutDashboard, pos: ScanLine, receiving: PackagePlus, catalog: Boxes, orders: ReceiptText, more: Settings2 };
export function AdminSidebar({ items, active, onSelect }: {
  items: readonly { key: AdminPrimaryKey; label: string }[];
  active: AdminPrimaryKey;
  onSelect: (key: AdminPrimaryKey) => void;
}) {
  return <nav aria-label="后台主导航" className="space-y-2" data-admin-primary-navigation>
    {items.map(item => {
      const Icon = icons[item.key];
      return <button key={item.key} type="button" data-admin-section={item.key} aria-current={active === item.key ? "page" : undefined}
        onClick={() => onSelect(item.key)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active === item.key ? "bg-ink text-white" : "text-stone-600 hover:bg-stone-100"}`}>
        <Icon size={20} aria-hidden="true" />{item.label}
      </button>;
    })}
  </nav>;
}
