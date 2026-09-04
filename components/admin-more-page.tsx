"use client";

import type { AdminView } from "@/lib/admin-navigation";

export function AdminMorePage({ isOwner, canUse, onSelect }: {
  isOwner: boolean; canUse: (view: AdminView) => boolean; onSelect: (view: AdminView) => void;
}) {
  const button = (view: AdminView, label: string) => canUse(view) ? <button key={view} className="admin-button-secondary" type="button" data-admin-tool={view} onClick={() => onSelect(view)}>{label}</button> : null;
  return <section className="admin-panel space-y-4"><h2 className="text-xl font-black">更多管理</h2>
    {isOwner ? <details data-admin-management-group="product"><summary className="cursor-pointer py-3 font-bold">商品设置</summary><div className="flex flex-wrap gap-2">
      {button("categories", "分类")}{button("suppliers", "供应商")}{button("csv", "CSV 导入")}{button("images", "批量图片")}
    </div></details> : null}
    <details data-admin-management-group="store"><summary className="cursor-pointer py-3 font-bold">门店设置与标签</summary><div className="flex flex-wrap gap-2">
      {button("printing", "打印设置")}{button("labels", "标签批量补打")}{button("staff", "员工与权限")}
      {isOwner ? <a className="admin-button-secondary" href="/admin/settings">店铺资料（开发者验证）</a> : null}
    </div></details>
    {isOwner ? <details data-admin-management-group="system"><summary className="cursor-pointer py-3 font-bold">系统管理</summary><div className="flex flex-wrap gap-2">
      <a className="admin-button-secondary" href="/admin/settings">功能开关（开发者验证）</a>
      {button("backup", "备份恢复")}
      <a className="admin-button-secondary" href="/admin/legal-settings">法律设置（开发者验证）</a>
      {button("diagnostics", "系统诊断")}{button("quickSale", "库存紧急扣减（无销售订单）")}
    </div></details> : null}
  </section>;
}
