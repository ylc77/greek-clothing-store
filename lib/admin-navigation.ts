import type { AdminRole } from "./admin-auth";

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
