"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { AdminSidebar } from "./admin-sidebar";
import type { AdminPrimaryKey } from "@/lib/admin-navigation";

export function AdminShell({ items, active, onSelect, children }: {
  items: readonly { key: AdminPrimaryKey; label: string }[];
  active: AdminPrimaryKey; onSelect: (key: AdminPrimaryKey) => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const close = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  const select = (key: AdminPrimaryKey) => { onSelect(key); setOpen(false); };
  return <div className="mx-auto max-w-[120rem] px-3 py-4 sm:px-6 xl:grid xl:grid-cols-[200px_minmax(0,1fr)] xl:gap-6">
    <aside className="hidden xl:block"><div className="sticky top-6 rounded-2xl border border-stone-200 bg-white p-3">
      <p className="px-4 py-3 text-xs font-bold text-stone-400">门店管理</p><AdminSidebar items={items} active={active} onSelect={select} />
    </div></aside>
    <div className="min-w-0">
      <button ref={trigger} className="mb-3 flex min-h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-bold xl:hidden" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} />菜单 · {items.find(item => item.key === active)?.label}</button>
      {children}
    </div>
    <dialog ref={dialog} aria-label="后台菜单" onCancel={() => setOpen(false)} onClose={() => { setOpen(false); trigger.current?.focus(); }} className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r bg-white p-4 backdrop:bg-black/40">
      <button autoFocus type="button" className="mb-4 flex min-h-11 items-center gap-2 rounded-lg px-3 font-bold" onClick={() => setOpen(false)}><X size={20} />关闭菜单</button>
      <AdminSidebar items={items} active={active} onSelect={select} />
    </dialog>
  </div>;
}
