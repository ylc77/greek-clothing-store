import type { AdminRole } from "./admin-auth";

// Primary destinations are presentation only. Legacy views retain their existing authorization.
export const adminPrimaryNavigation = [
  { key: "workspace", label: "工作台" },
  { key: "pos", label: "扫码收银" },
  { key: "receiving", label: "到货入库" },
  { key: "catalog", label: "商品库存" },
  { key: "orders", label: "订单售后" },
  { key: "more", label: "更多管理" },
] as const;
export type AdminPrimaryKey = (typeof adminPrimaryNavigation)[number]["key"];
// Presentation only: callers must retain the original status/code and recovery metadata.
export function adminVisibleMessage(message: string, _showDiagnostics: boolean): string {
  return /\b(?:rpc|migration|supabase|postgrest|sqlstate|operation id|job)\b|feature[ _-]?flag|业务 ID/i.test(message)
    ? "操作暂不可用，请联系负责人。若已提交，请先核对结果，不要重复创建操作。"
    : message;
}
export type AdminView = AdminNavigationTab | "workspace" | "more" | "ordersAll" | "returns" | "diagnostics" | "printing" | "staff" | "backup";
export const legacyAdminSection: Record<AdminNavigationTab, AdminPrimaryKey> = {
  dashboard: "catalog", check: "catalog", quickAdd: "catalog", add: "catalog",
  stockLookup: "catalog", inventory: "catalog", labels: "catalog",
  stockOperations: "receiving", pos: "pos", posOrders: "orders", onlineOrders: "orders",
  posDaily: "orders", quickSale: "more", csv: "more", images: "more", categories: "more", suppliers: "more",
};
export function adminSectionForView(view: AdminView, mode: "receiving" | "stocktake" | "return"): AdminPrimaryKey {
  if (view === "stockOperations") return mode === "receiving" ? "receiving" : mode === "stocktake" ? "catalog" : "orders";
  if (view === "workspace") return "workspace";
  if (view === "ordersAll" || view === "returns") return "orders";
  return legacyAdminSection[view as AdminNavigationTab] || "more";
}
export function getAdminPrimaryNavigation(canUse: (view: AdminView) => boolean, compact: boolean) {
  const views: Record<AdminPrimaryKey, AdminView[]> = {
    workspace: ["workspace"], pos: compact ? [] : ["pos"], receiving: ["stockOperations"],
    catalog: ["dashboard", "inventory", "labels"], orders: ["posOrders", "onlineOrders", "stockOperations"], more: ["more"],
  };
  return adminPrimaryNavigation.filter(item => views[item.key].some(canUse));
}
export function getAdminDefaultView(role: AdminRole): AdminView {
  return role === "staff" ? "pos" : role === "inventory" ? "stockOperations" : "workspace";
}
export const adminWorkspaceActions: Record<AdminRole, Array<{ view: AdminNavigationTab; label: string; mode?: "receiving" | "stocktake" }>> = {
  owner: [{ view: "pos", label: "扫码收银" }, { view: "stockOperations", label: "新货入库", mode: "receiving" }, { view: "onlineOrders", label: "在线订单" }, { view: "quickAdd", label: "拍照上新" }, { view: "stockOperations", label: "盘点", mode: "stocktake" }, { view: "labels", label: "标签补打" }],
  staff: [{ view: "pos", label: "扫码收银" }, { view: "inventory", label: "库存查询" }, { view: "onlineOrders", label: "在线订单" }, { view: "dashboard", label: "商品查询" }],
  inventory: [{ view: "stockOperations", label: "新货入库", mode: "receiving" }, { view: "inventory", label: "库存查询" }, { view: "stockOperations", label: "盘点", mode: "stocktake" }, { view: "labels", label: "标签补打" }],
  readonly: [{ view: "inventory", label: "库存查询" }, { view: "dashboard", label: "商品查询" }, { view: "posOrders", label: "门店订单" }],
};

export const adminNavigationTabKeys = [
  "dashboard",
  "check",
  "quickAdd",
  "quickSale",
  "stockLookup",
  "stockOperations",
  "pos",
  "posOrders",
  "onlineOrders",
  "posDaily",
  "inventory",
  "labels",
  "add",
  "csv",
  "images",
  "categories",
  "suppliers",
] as const;

export type AdminNavigationTab = (typeof adminNavigationTabKeys)[number];

export const adminNavigationTabs: Array<{ key: AdminNavigationTab; label: string }> = [
  { key: "stockLookup", label: "库存快查" },
  { key: "stockOperations", label: "库存作业" },
  { key: "pos", label: "POS 扫码" },
  { key: "posOrders", label: "销售记录" },
  { key: "onlineOrders", label: "在线订单" },
  { key: "posDaily", label: "POS 日报" },
  { key: "inventory", label: "库存管理" },
  { key: "labels", label: "标签打印" },
  { key: "dashboard", label: "商品管理" },
  { key: "quickAdd", label: "拍照上新" },
  { key: "quickSale", label: "快速售出" },
  { key: "check", label: "问题商品检查" },
  { key: "add", label: "商品新增 / 编辑" },
  { key: "csv", label: "CSV 导入" },
  { key: "images", label: "批量图片" },
  { key: "categories", label: "分类" },
  { key: "suppliers", label: "供货商" },
];

export const adminNavigationLabelByKey = new Map(
  adminNavigationTabs.map((item) => [item.key, item.label]),
);

export const adminCommonNavigationLabelByKey = new Map(adminNavigationLabelByKey);
adminCommonNavigationLabelByKey.set("stockOperations", "到货扫码");

export const adminInternalOnlyTabKeys = ["add", "check", "quickSale", "posDaily"] as const satisfies readonly AdminNavigationTab[];
export const adminDesktopOnlyTabKeys = ["pos", "csv", "images"] as const satisfies readonly AdminNavigationTab[];

const internalOnlyTabKeySet = new Set<AdminNavigationTab>(adminInternalOnlyTabKeys);

export const adminNavigableTabKeys = adminNavigationTabKeys.filter(
  (key) => !internalOnlyTabKeySet.has(key),
);

export type AdminNavigationGroupKey = "inventory" | "sales" | "catalog" | "batch";

export const adminNavigationGroups: Array<{
  key: AdminNavigationGroupKey;
  label: string;
  description: string;
  tabKeys: AdminNavigationTab[];
  desktopOnly?: boolean;
}> = [
  {
    key: "inventory",
    label: "库存与标签",
    description: "查询、到货、盘点、退货、库存总览和标签",
    tabKeys: ["stockLookup", "stockOperations", "inventory", "labels"],
  },
  {
    key: "sales",
    label: "销售与订单",
    description: "在线订单、POS 扫码和销售记录",
    tabKeys: ["onlineOrders", "pos", "posOrders"],
  },
  {
    key: "catalog",
    label: "商品资料",
    description: "拍照上新、商品、分类和供货商",
    tabKeys: ["quickAdd", "dashboard", "categories", "suppliers"],
  },
  {
    key: "batch",
    label: "批量工具",
    description: "CSV、批量图片和商品资料导出",
    tabKeys: ["csv", "images"],
    desktopOnly: true,
  },
];

const roleDefaultCommonTabs: Record<AdminRole, AdminNavigationTab[]> = {
  owner: ["onlineOrders", "stockLookup", "stockOperations", "quickAdd", "dashboard", "pos"],
  staff: ["onlineOrders", "stockLookup", "dashboard", "pos"],
  inventory: ["stockOperations", "stockLookup", "labels", "inventory"],
  readonly: ["stockLookup", "dashboard", "posOrders"],
};

export function getDefaultAdminCommonTabs(role: AdminRole): AdminNavigationTab[] {
  return [...roleDefaultCommonTabs[role]];
}

export function normalizeAdminCommonTabs(
  value: unknown,
  fallback: readonly AdminNavigationTab[],
): AdminNavigationTab[] {
  if (!Array.isArray(value)) return [...fallback];
  const allowed = new Set<AdminNavigationTab>(adminNavigableTabKeys);
  const normalized = Array.from(new Set(
    value.filter((key): key is AdminNavigationTab => typeof key === "string" && allowed.has(key as AdminNavigationTab)),
  ));
  return normalized.length > 0 && normalized.some((key) => isAdminTabVisibleInViewport(key, true))
    ? normalized
    : [...fallback];
}

export function adminCommonTabsStorageKey(role: AdminRole) {
  return `clothing-admin-common-tabs-v2:${role}`;
}

export function isAdminTabVisibleInViewport(tab: AdminNavigationTab, compactViewport: boolean) {
  return !compactViewport || !adminDesktopOnlyTabKeys.includes(tab as (typeof adminDesktopOnlyTabKeys)[number]);
}

export function moveAdminCommonTab(
  tabs: readonly AdminNavigationTab[],
  key: AdminNavigationTab,
  direction: -1 | 1,
  visibleTabs: readonly AdminNavigationTab[],
) {
  const visibleIndex = visibleTabs.indexOf(key);
  const targetVisibleKey = visibleTabs[visibleIndex + direction];
  if (visibleIndex < 0 || !targetVisibleKey) return [...tabs];
  const sourceIndex = tabs.indexOf(key);
  const targetIndex = tabs.indexOf(targetVisibleKey);
  if (sourceIndex < 0 || targetIndex < 0) return [...tabs];
  const next = [...tabs];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}
