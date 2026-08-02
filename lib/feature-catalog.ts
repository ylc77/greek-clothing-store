export const featureKeys = [
  "storefront",
  "product_management",
  "inventory",
  "quick_sell",
  "pos_checkout",
  "pos_orders",
  "pos_void",
  "pos_reports",
  "receipt_printing",
  "barcode_labels",
  "csv_import",
  "online_orders",
  "staff_accounts",
  "ai_tools",
  "backup_tools",
] as const;

export type FeatureKey = (typeof featureKeys)[number];
export type FeaturePlan = "basic" | "standard" | "advanced" | "custom";
export type FeatureFlags = Record<FeatureKey, boolean>;
export type FeatureGroupKey = "core" | "store" | "growth";

export const featureCatalog: Record<FeatureKey, {
  label: string;
  desc: string;
  group: FeatureGroupKey;
  alwaysOn?: boolean;
}> = {
  storefront: { label: "希腊语 / 英语前台", desc: "首页、分类、商品详情、联系与法律页面", group: "core", alwaysOn: true },
  product_management: { label: "商品与资料管理", desc: "商品列表、拍照上新、新增编辑、图片、分类和供货商", group: "core", alwaysOn: true },
  inventory: { label: "尺码库存管理", desc: "库存快查、库存作业、调整、流水、对账和快速售出", group: "core", alwaysOn: true },
  quick_sell: { label: "快速售出", desc: "仅 owner 使用的事务库存快速扣减工具，不创建 POS 订单或付款记录", group: "core" },
  pos_checkout: { label: "POS 扫码扣库存", desc: "扫码或搜索商品，确认后扣减系统库存；不代替真实收银机", group: "store" },
  pos_orders: { label: "POS 销售记录", desc: "查看系统内扫码销售历史和详情", group: "store" },
  pos_void: { label: "POS 作废恢复库存", desc: "纠正误操作并把对应数量恢复到库存", group: "store" },
  pos_reports: { label: "POS 营业日报", desc: "系统内销售汇总；不作为税务或会计报表", group: "store" },
  receipt_printing: { label: "销售记录小票", desc: "浏览器预览和打印；不是正式税务发票", group: "store" },
  barcode_labels: { label: "条码与标签打印", desc: "按商品和尺码生成 Variant 条码、筛选、预览和打印", group: "store" },
  csv_import: { label: "CSV 批量导入", desc: "批量导入商品、尺码和库存资料", group: "store" },
  staff_accounts: { label: "员工账号与角色", desc: "员工登录并按收银、库存或只读角色限制权限", group: "store" },
  online_orders: { label: "在线购物", desc: "购物车、货到付款、到店自取和在线订单管理", group: "core", alwaysOn: true },
  ai_tools: { label: "AI 商品与导购工具", desc: "翻译、商品文案、资料补全、图片生成和前台 AI 导购", group: "growth" },
  backup_tools: { label: "维护数据导出", desc: "仅维护者 / owner 使用的后台数据导出入口", group: "growth" },
};

export const featureGroups: Array<{ key: FeatureGroupKey; label: string; desc: string }> = [
  { key: "core", label: "所有版本共同具备", desc: "服装店网站、商品资料和尺码库存是本模板的固定基础，不能关闭。" },
  { key: "store", label: "实体店日常运营", desc: "标准版开始提供扫码扣库存、纠错、标签、批量导入和员工账号。" },
  { key: "growth", label: "增值能力", desc: "高级版增加 AI 商品与导购工具及维护数据导出。" },
];

const basicFeatures: FeatureFlags = {
  storefront: true,
  product_management: true,
  inventory: true,
  quick_sell: true,
  pos_checkout: false,
  pos_orders: false,
  pos_void: false,
  pos_reports: false,
  receipt_printing: false,
  barcode_labels: false,
  csv_import: false,
  online_orders: true,
  staff_accounts: false,
  ai_tools: false,
  backup_tools: false,
};

const standardFeatures: FeatureFlags = {
  storefront: true,
  product_management: true,
  inventory: true,
  quick_sell: true,
  pos_checkout: true,
  pos_orders: true,
  pos_void: true,
  pos_reports: true,
  receipt_printing: true,
  barcode_labels: true,
  csv_import: true,
  online_orders: true,
  staff_accounts: true,
  ai_tools: false,
  backup_tools: false,
};

const advancedFeatures: FeatureFlags = Object.fromEntries(
  featureKeys.map((key) => [key, true]),
) as FeatureFlags;

export const featurePlanPresets: Record<Exclude<FeaturePlan, "custom">, FeatureFlags> = {
  basic: basicFeatures,
  standard: standardFeatures,
  advanced: advancedFeatures,
};

export const featurePlanInfo: Record<Exclude<FeaturePlan, "custom">, {
  label: string;
  audience: string;
  highlights: string[];
}> = {
  basic: {
    label: "基础版",
    audience: "适合单人维护、需要双语网店与尺码库存管理的小型服装店。",
    highlights: ["双语在线商店", "货到付款与到店自取", "商品与图片", "尺码库存快查"],
  },
  standard: {
    label: "标准版",
    audience: "推荐实体店日常使用，覆盖扫码扣库存、标签和员工协作。",
    highlights: ["基础版全部功能", "POS 扫码与纠错", "在线订单", "条码标签", "CSV 导入", "员工账号"],
  },
  advanced: {
    label: "高级版",
    audience: "适合需要 AI 商品工具、AI 导购和维护导出的客户。",
    highlights: ["标准版全部功能", "AI 商品与导购", "维护数据导出"],
  },
};

const requirements: Partial<Record<FeatureKey, FeatureKey[]>> = {
  quick_sell: ["inventory"],
  pos_checkout: ["inventory"],
  pos_orders: ["pos_checkout"],
  pos_void: ["pos_orders"],
  pos_reports: ["pos_orders"],
  receipt_printing: ["pos_orders"],
  barcode_labels: ["product_management", "inventory"],
  csv_import: ["product_management"],
  online_orders: ["storefront", "product_management", "inventory"],
  ai_tools: ["storefront", "product_management"],
};

export function isFeaturePlan(value: unknown): value is FeaturePlan {
  return value === "basic" || value === "standard" || value === "advanced" || value === "custom";
}

export function enforceFeatureDependencies(flags: FeatureFlags): FeatureFlags {
  const next = { ...flags };
  for (const key of featureKeys) {
    if (featureCatalog[key].alwaysOn) next[key] = true;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of featureKeys) {
      if (!next[key]) continue;
      for (const requirement of requirements[key] || []) {
        if (next[requirement]) continue;
        next[requirement] = true;
        changed = true;
      }
    }
  }
  return next;
}

export function normalizeFeatureFlags(
  value: unknown,
  fallback: FeatureFlags = featurePlanPresets.basic,
): FeatureFlags {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalized = Object.fromEntries(
    featureKeys.map((key) => [key, typeof source[key] === "boolean" ? source[key] : fallback[key]]),
  ) as FeatureFlags;
  return enforceFeatureDependencies(normalized);
}

export function getFeatureFlagsForPlan(plan: Exclude<FeaturePlan, "custom">): FeatureFlags {
  return { ...featurePlanPresets[plan] };
}

export function toggleFeatureWithDependencies(flags: FeatureFlags, key: FeatureKey): FeatureFlags {
  if (featureCatalog[key].alwaysOn) return flags;
  const next = { ...flags, [key]: !flags[key] };

  if (next[key]) return enforceFeatureDependencies(next);

  const disabled = new Set<FeatureKey>([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of featureKeys) {
      if (disabled.has(candidate)) continue;
      if ((requirements[candidate] || []).some((requirement) => disabled.has(requirement))) {
        disabled.add(candidate);
        changed = true;
      }
    }
  }
  for (const disabledKey of disabled) next[disabledKey] = false;
  return enforceFeatureDependencies(next);
}
