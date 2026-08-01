"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  categories,
  subcategoriesByCategory,
  subcategoryList,
  type ProductCategory,
  type ProductFormData,
  type SizeSystem,
  type Supplier,
  type VariantProcurement,
} from "@/lib/types";
import { getTotalStock as effectiveStock } from "@/lib/product-stock";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/admin-toast";
import { PosReceiptPreview } from "@/components/pos-receipt-preview";
import { LabelPrintPreview, type LabelSize, type PrintableVariantLabel } from "@/components/label-print-preview";
import type { AdminPermission, AdminRole } from "@/lib/admin-auth";
import { featurePlanPresets, type FeatureFlags, type FeatureKey } from "@/lib/feature-catalog";
import { getSupabaseBrowserAuthClient } from "@/lib/supabase";
import { tokenUpdateForSupabaseAuthEvent } from "@/lib/admin-session-lifecycle";
import { skroutzReadinessIssues } from "@/lib/skroutz-readiness";
import { PosOperationIdStore } from "@/lib/pos-operation-id";
import { InventoryOperationIdStore, InventoryOperationStateError } from "@/lib/inventory-operation-id";
import {
  ProductOperationIdStore,
  ProductOperationStateError,
  createProductOperationFingerprint,
} from "@/lib/product-operation-id";
import {
  CsvImportOperationIdStore,
  CsvImportOperationStateError,
  createCsvImportFingerprint,
} from "@/lib/csv-operation-id";
import type { ProductCsvImportMode, ProductCsvInventoryMode } from "@/lib/csv-import";
import { PRODUCT_CSV_FIELDS, serializeCsv } from "@/lib/csv-output";
import type { BusinessSettings } from "@/lib/settings";
import {
  formatAthensBusinessDate,
  formatAthensDateTime,
  normalizeLabelCopies,
  type PrintLanguage,
} from "@/lib/operations-print";
import {
  addVisibleVariantsToSelection,
  barcodeIsPresent,
  clearBarcodeLabelQueue,
  getBarcodeLabelSelectionSummary,
  selectVisibleMissingBarcodes,
} from "@/lib/barcode-label-selection";
import { MAX_BULK_BARCODE_VARIANTS } from "@/lib/barcode-bulk-request";
import { getStockOperationBarcodePlan } from "@/lib/stock-receiving";
import { FIXED_PRODUCT_VAT_RATE } from "@/lib/product-policy";
import { ColorSizeInventoryEditor } from "@/components/color-size-inventory-editor";
import {
  buildVariantSku,
  matrixColors,
  matrixRowsFromVariants,
  matrixSizeStock,
  matrixSizes,
  matrixTotal,
  normalizeVariantColor,
  normalizeVariantSize,
  type ProductVariantMatrixRow,
  variantCatalogKey,
  variantProcurementKey,
} from "@/lib/product-variant-matrix";

/* ── Types ───────────────────────────────────────────────── */
type AdminProductVariant = {
  id: string;
  variant_sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: number | null;
  cost_price?: number | null;
  supplier_id?: string | null;
  supplier_sku?: string | null;
  reorder_level?: number | null;
  active: boolean;
  sort_order: number;
  quantity_on_hand: number;
  quantity_reserved: number;
};
type AdminProduct = ProductFormData & {
  id: string;
  metadata_version: number;
  structure_version: number;
  size_stock?: Record<string, number> | null;
  variant_procurement?: Record<string, VariantProcurement>;
  variants?: AdminProductVariant[];
};
type ApiResult = {
  rowNumber?: number;
  fileName?: string;
  sku: string;
  ok: boolean;
  message: string;
  imageUrl?: string;
  translated?: boolean;
  translateError?: string;
  statusLabel?: string;
  statusTone?: "success" | "error" | "pending" | "info";
};
class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly operationSafeToDiscard: boolean;
  readonly jobId: string | null;

  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = typeof data.code === "string" ? data.code : "REQUEST_FAILED";
    this.operationSafeToDiscard = data.operationSafeToDiscard === true;
    this.jobId = typeof data.jobId === "string" ? data.jobId : null;
  }
}
type CsvPreviewRow = {
  rowNumber: number;
  sku: string;
  normalizedSku: string;
  metadata: Record<string, unknown>;
  variants: Array<Record<string, unknown>>;
};
type CsvPreview = {
  filename: string;
  fileHash: string;
  byteLength: number;
  importMode: ProductCsvImportMode;
  inventoryMode: ProductCsvInventoryMode;
  headers: string[];
  rowCount: number;
  rows: CsvPreviewRow[];
  previewTruncated: boolean;
};
type CsvImportJob = {
  id: string;
  client_request_id: string;
  filename: string;
  import_mode: ProductCsvImportMode;
  inventory_mode: ProductCsvInventoryMode;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  total_rows: number;
  pending_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  created_at?: string;
  completed_at?: string | null;
};
type CsvImportJobRow = {
  row_number: number;
  normalized_sku: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempt_count: number;
  retryable: boolean;
  product_id: string | number | null;
  error_code: string | null;
  error_summary: string | null;
  result_snapshot: Record<string, unknown>;
};
type CsvImportJobView = {
  job: CsvImportJob;
  rows: CsvImportJobRow[];
  totalRows: number;
  offset: number;
  limit: number;
  processed?: number;
};
type CsvTranslationResult = {
  rowNumber: number;
  translated: boolean;
  translateError?: string;
  name_en: string;
  description_en: string;
  name_gr: string;
  description_gr: string;
};
const csvImportModeLabels: Record<ProductCsvImportMode, string> = {
  create_only: "仅新增",
  update_existing: "仅更新已有商品",
  upsert: "新增或更新",
};
const csvInventoryModeLabels: Record<ProductCsvInventoryMode, string> = {
  metadata_only: "只导入商品资料",
  set_inventory: "按 CSV 设置库存",
};
const csvJobStatusLabels: Record<CsvImportJob["status"], string> = {
  pending: "待处理",
  running: "处理中",
  completed: "已完成",
  partial: "部分成功",
  failed: "失败",
};
type TranslationResult = { name_gr: string; description_gr: string; name_en: string; description_en: string };
type ProductCopyResult = TranslationResult & {
  name_cn?: string;
  description_cn?: string;
  material?: string;
  material_evidence?: "label_visible" | "owner_provided" | "visual_guess" | "unknown";
  fit_type?: "regular" | "slim" | "loose";
  ai_keywords?: string;
  style_tags?: string;
  visual_summary?: string;
  images_analyzed?: number;
  generation_mode?: "vision" | "text";
};
type ImageUploadOptions = { sku?: string; mode?: "main" | "gallery" };
type ImageDeleteOptions = { sku: string; kind: "main" | "gallery"; index?: number };
type Tab = "dashboard" | "check" | "quickAdd" | "quickSale" | "stockLookup" | "stockOperations" | "pos" | "posOrders" | "posDaily" | "inventory" | "labels" | "add" | "csv" | "images" | "skroutz" | "categories" | "suppliers";
type AdminSession = { role: AdminRole; permissions: AdminPermission[]; authType?: "password" | "account"; email?: string | null; displayName?: string | null };
type InventoryItem = {
  product_id: number;
  product_name: string;
  product_name_en: string;
  product_name_gr: string;
  product_sku: string;
  category: string;
  subcategory: string;
  variant_id: string;
  variant_sku: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
  supplier_sku?: string | null;
  supplier_name?: string | null;
  supplier_style_code?: string | null;
  cost_price?: number | null;
  reorder_level?: number | null;
  price: number;
  active: boolean;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  legacy_stock: number;
  erp_product_stock: number;
  stock_matches_legacy: boolean;
  size_stock_matches_legacy: boolean;
};
type StockLookupGroup = {
  productId: number;
  productName: string;
  productSku: string;
  imageUrl: string;
  totalAvailable: number;
  items: InventoryItem[];
};
type LabelProductGroup = {
  productId: number;
  productName: string;
  productSku: string;
  imageUrl: string;
  category: string;
  subcategory: string;
  items: InventoryItem[];
};
type LabelStockFilter = "all" | "in_stock" | "out_of_stock";
type InventoryMovement = {
  id: string;
  variant_id: string;
  variant_sku: string;
  product_sku: string;
  product_name: string;
  movement_type: string;
  quantity_before: number;
  quantity_after: number;
  quantity_delta: number;
  reason: string;
  source_type: string | null;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
};
type InventoryReconciliation = {
  stockVsBalanceMismatches: unknown[];
  sizeStockMismatches: unknown[];
  productsWithoutVariants: unknown[];
  variantsWithoutMainStoreBalance: unknown[];
  duplicateVariantSkus: unknown[];
  duplicateBarcodes: unknown[];
  reservedExceedsOnHand: unknown[];
  blankMovementReasons: unknown[];
  negativeBalances: unknown[];
  duplicateOperationKeys: unknown[];
  movementDeltaMismatches: unknown[];
  movementContinuityMismatches: unknown[];
  balanceVsLatestMovementMismatches: unknown[];
  balancesWithoutMovements: unknown[];
  operationsMissingMovements: unknown[];
  runtimeHealth: {
    ready: boolean;
    version: string | null;
    apply_deployed: boolean;
    apply_executable: boolean;
    operations_table_deployed: boolean;
  };
};
type InventoryAdjustState = {
  item: InventoryItem | null;
  mode: "set_to" | "adjust_by";
  quantity: string;
  reason: string;
  submitting: boolean;
  message: string;
};
type StockOperationMode = "stocktake" | "receiving" | "return";
type InventoryStatusFilter = "all" | "normal" | "low_stock" | "out_of_stock" | "inactive" | "mismatch";
type InventorySort = "stock_asc" | "stock_desc" | "sku" | "updated";
type PosPaymentMethod = "cash" | "card" | "other";
type PosSearchItem = {
  product_id: number;
  variant_id: string;
  product_sku: string;
  variant_sku: string;
  barcode: string | null;
  name: string;
  size: string | null;
  color: string | null;
  price: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  product_active: boolean;
  variant_active: boolean;
  image_url: string;
  outOfStock?: boolean;
};
type PosCartItem = PosSearchItem & { cartQuantity: number };
type PosOrderResult = {
  order?: {
    id: string;
    order_number: string;
    total: number;
    subtotal: number;
    discount_total: number;
    payment_status: string;
    status: string;
    created_at: string;
  };
  items?: Array<{
    id?: string;
    product_sku?: string;
    variant_sku?: string;
    name?: string;
    name_en?: string;
    name_gr?: string;
    size?: string | null;
    color?: string | null;
    quantity?: number;
    unit_price?: number;
    line_total?: number;
  }>;
  payments?: Array<{ method?: string; amount?: number; status?: string }>;
  alreadyProcessed?: boolean;
  legacySyncWarning?: string[];
};
type PosOrdersView = "checkout" | "history";
type PosOrderStatusFilter = "all" | "completed" | "voided" | "refunded";
type PosPaymentFilter = "all" | "cash" | "card" | "other";
type PosDateRangeFilter = "today" | "yesterday" | "last7days" | "all";
type PosOrderListItem = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  source: string;
  total: number;
  currency: string;
  created_at: string;
  completed_at: string | null;
  payment_method: string | null;
  payment_method_status: string | null;
  items_count: number;
  created_by: string | null;
  notes: string | null;
};
type PosOrderDetail = {
  order: PosOrderListItem & {
    subtotal?: number;
    discount_total?: number;
    updated_at?: string;
    voided_at?: string | null;
    refunded_at?: string | null;
  };
  items: Array<{
    id: string;
    product_sku: string;
    variant_sku: string;
    barcode: string | null;
    name: string;
    name_en: string;
    name_gr: string;
    size: string | null;
    color: string | null;
    quantity: number;
    unit_price: number;
    discount_total: number;
    line_total: number;
    created_at: string;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: number;
    currency: string;
    status: string;
    provider: string | null;
    provider_reference: string | null;
    created_at: string;
  }>;
  stock_movements: Array<{
    id: string;
    variant_id: string;
    movement_type: string;
    quantity_before: number;
    quantity_after: number;
    quantity_delta: number;
    reason: string;
    source_type: string | null;
    source_id: string | null;
    created_by: string | null;
    created_at: string;
  }>;
};
type PosDailyReport = {
  date: string;
  summary: {
    ordersTotal: number;
    completedOrders: number;
    voidedOrders: number;
    refundedOrders: number;
    grossSales: number;
    voidedTotal: number;
    discountTotal: number;
    netSales: number;
    itemsSold: number;
  };
  paymentMethods: Array<{ method: string; amount: number; count: number }>;
  topItems: Array<{ product_sku: string; variant_sku: string; name: string; quantity: number; total: number }>;
  orders: Array<{ id: string; order_number: string; status: string; payment_status: string; total: number; currency: string; created_at: string; payments_count: number; items_count: number }>;
  pagination: { total: number; limit: number; offset: number };
  health: {
    issueOrders: number;
    missingItems: number;
    itemAmountMismatches: number;
    paymentMismatches: number;
    saleMovementMismatches: number;
    voidMovementMismatches: number;
  };
};
type PosVoidDialogState = {
  order: PosOrderListItem;
  reason: string;
  submitting: boolean;
  message: string;
};
type QuickAddState = {
  category: ProductCategory;
  subcategory: string;
  size_system: SizeSystem;
  price: number;
  stock: number;
  sizes: string;
  size_stock: string;
  color: string;
  brand: string;
  name_cn: string;
  name_gr: string;
  name_en: string;
  description_cn: string;
  description_gr: string;
  description_en: string;
  material: string;
  fit_type: string;
  ai_keywords: string;
  style_tags: string;
  notes: string;
  is_active: boolean;
};

/* ── Constants ───────────────────────────────────────────── */
const emptyProduct: ProductFormData = { sku: "", name_cn: "", name_gr: "", name_en: "", description_cn: "", description_gr: "", description_en: "", category: "men", subcategory: "tshirts", price: 0, stock: 0, sizes: "", size_system: "letter", image_url: "", image_urls: "", brand: "", supplier_id: "", supplier_style_code: "", barcode: "", ean: "", mpn: "", vat: FIXED_PRODUCT_VAT_RATE, color: "", skroutz_url: "", is_active: true, fit_type: "regular", material: "", fiber_composition_gr: "", fiber_composition_en: "", care_instructions_gr: "", care_instructions_en: "", country_of_origin: "", manufacturer_name: "", manufacturer_contact: "", eu_responsible_person: "", product_safety_notes_gr: "", product_safety_notes_en: "", ai_keywords: "", style_tags: "", size_chart: "", material_verified: false };
const csvFields = [...PRODUCT_CSV_FIELDS];
const quickCsvFields = ["sku","name_cn","description_cn","category","subcategory","price","stock","sizes","size_system","size_stock","brand","color","image_url","image_urls","is_active"];
const maxProductVisionImages = 2;
const fallbackCategoryNamesCn: Record<string, string> = {
  women: "女装", men: "男装", shoes: "鞋子", bags: "包包", luggage: "行李箱", hats: "帽子", jewelry: "首饰", other: "其他",
};
const fallbackSubcategoryNamesCn: Record<string, string> = {
  dresses: "连衣裙", tops: "上衣", tshirts: "T恤", shirts: "衬衫", hoodies: "卫衣", jackets: "外套", trousers: "长裤", jeans: "牛仔裤", shorts: "短裤", skirts: "半身裙",
  sneakers: "运动鞋", boots: "靴子", sandals: "凉鞋", heels: "高跟鞋", handbags: "手提包", backpacks: "双肩包", wallets: "钱包", suitcases: "行李箱", travel_bags: "旅行包",
  caps: "鸭舌帽", beanies: "针织帽", necklaces: "项链", bracelets: "手链", earrings: "耳环", rings: "戒指", accessories: "配饰",
};
const tabs: { key: Tab; label: string }[] = [
  { key: "stockLookup", label: "库存快查" },
  { key: "stockOperations", label: "库存作业" },
  { key: "pos", label: "POS 扫码" },
  { key: "posOrders", label: "POS 订单" },
  { key: "posDaily", label: "POS 日报" },
  { key: "inventory", label: "库存管理" },
  { key: "labels", label: "标签打印" },
  { key: "dashboard", label: "商品列表" }, { key: "quickAdd", label: "拍照上新" }, { key: "quickSale", label: "快速售出" }, { key: "check", label: "上线检查" }, { key: "add", label: "新增/编辑" }, { key: "csv", label: "CSV 导入" }, { key: "images", label: "图片上传" }, { key: "categories", label: "分类管理" }, { key: "suppliers", label: "供货商" }, { key: "skroutz", label: "Skroutz Feed" },
];
const defaultCommonTabKeys: Tab[] = ["stockLookup", "pos", "quickAdd", "add", "dashboard"];
const allTabKeys = tabs.map(item => item.key);
const adminCommonTabsStorageKey = "clothing-admin-common-tabs-v1";
const tabLabelByKey = new Map(tabs.map(item => [item.key, item.label]));
const ownerOnlyTabs = new Set<Tab>(["quickAdd", "quickSale", "add", "csv", "images", "categories", "suppliers"]);
const desktopOnlyTabs = new Set<Tab>(["pos"]);
const tabPermissions: Partial<Record<Tab, AdminPermission>> = {
  dashboard: "products:read",
  check: "products:read",
  stockLookup: "inventory:read",
  stockOperations: "inventory:write",
  pos: "pos:checkout",
  posOrders: "pos:read",
  posDaily: "pos:read",
  inventory: "inventory:read",
  labels: "labels:write",
  skroutz: "feed:read",
};
const tabFeatures: Partial<Record<Tab, FeatureKey>> = {
  dashboard: "product_management",
  check: "product_management",
  stockLookup: "inventory",
  stockOperations: "inventory",
  quickAdd: "product_management",
  quickSale: "quick_sell",
  pos: "pos_checkout",
  posOrders: "pos_orders",
  posDaily: "pos_reports",
  inventory: "inventory",
  labels: "barcode_labels",
  add: "product_management",
  csv: "csv_import",
  images: "product_management",
  categories: "product_management",
  suppliers: "product_management",
  skroutz: "skroutz_feed",
};

function normalizeCommonTabKeys(value: unknown): Tab[] {
  if (!Array.isArray(value)) return defaultCommonTabKeys;
  const normalized = Array.from(new Set(value.filter((key): key is Tab => typeof key === "string" && allTabKeys.includes(key as Tab))));
  return normalized.length > 0 ? normalized : defaultCommonTabKeys;
}
const defaultAdminFeatures: FeatureFlags = { ...featurePlanPresets.basic };
const clothingSizeOptions = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const womenEuSizeOptions = Array.from({ length: 12 }, (_, index) => `EU ${32 + index * 2}`);
const menEuSizeOptions = Array.from({ length: 12 }, (_, index) => `EU ${42 + index * 2}`);
const shoeSizeOptions = Array.from({ length: 14 }, (_, index) => `EU ${35 + index}`);
const oneSizeOptions = ["ONE SIZE"];
const sizeSortOrder = [...clothingSizeOptions, ...womenEuSizeOptions, ...menEuSizeOptions, ...shoeSizeOptions, ...oneSizeOptions];
function sizeKindForCategory(category: string) {
  const normalized = category.trim().toLowerCase();
  if (normalized === "shoes") return "shoes";
  if (normalized === "men" || normalized === "women") return "clothing";
  return "one";
}
function inferredSizeSystem(category: string): SizeSystem {
  const kind = sizeKindForCategory(category);
  if (kind === "shoes") return "eu_shoes";
  if (kind === "one") return "one_size";
  return "letter";
}
function sizeOptionsForSystem(system: SizeSystem | "", category: string) {
  const selected = system || inferredSizeSystem(category);
  if (selected === "eu_women_numeric") return womenEuSizeOptions;
  if (selected === "eu_men_numeric") return menEuSizeOptions;
  if (selected === "eu_shoes") return shoeSizeOptions;
  if (selected === "one_size") return oneSizeOptions;
  if (selected === "custom") return [];
  return clothingSizeOptions;
}
function stockTotal(stock: Record<string, number>) {
  return Object.values(stock).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}
function inventoryIssueCount(data: InventoryReconciliation | null) {
  if (!data) return 0;
  const reconciliationIssues = Object.values(data).reduce(
    (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
    0,
  );
  return reconciliationIssues + (data.runtimeHealth.ready ? 0 : 1);
}
function formatAdminDate(value: string) { return formatAthensDateTime(value, "en"); }
function posStatusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    completed: "已完成",
    paid: "已支付",
    voided: "已作废",
    refunded: "已退款",
    failed: "失败",
  };
  return labels[value || ""] || value || "-";
}
function paymentMethodLabel(value: string | null | undefined) {
  const labels: Record<string, string> = { cash: "现金", card: "刷卡", other: "其他" };
  return labels[value || ""] || value || "-";
}
function signedQuantity(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
function movementTypeLabel(value: string) {
  const labels: Record<string, string> = {
    initial_migration: "初始迁移",
    sale: "销售出库",
    manual_adjustment: "手动调整",
    correction: "库存修正",
    return: "退货入库",
    transfer_in: "调拨入库",
    transfer_out: "调拨出库",
    reservation: "预留库存",
    release_reservation: "释放预留",
  };
  return labels[value] || value || "-";
}
function sourceTypeLabel(value: string | null) {
  if (!value) return "-";
  const labels: Record<string, string> = {
    quick_sell: "快速售出",
    admin_create: "后台新增",
    admin_edit: "后台编辑",
    csv_import: "CSV 导入",
    admin_inventory_adjustment: "库存调整",
    admin_stocktake: "扫码盘点",
    admin_receiving: "到货入库",
    admin_customer_return: "退换货加回",
  };
  return labels[value] || value;
}
function inventoryStatusFor(item: InventoryItem, lowStockThreshold: number) {
  const reconciled = item.stock_matches_legacy && item.size_stock_matches_legacy;
  if (!reconciled) return { key: "mismatch", label: "对账异常", className: "bg-red-50 text-red-700" };
  if (!item.active) return { key: "inactive", label: "停用", className: "bg-stone-100 text-stone-500" };
  if (item.quantity_available <= 0) return { key: "out_of_stock", label: "缺货", className: "bg-red-50 text-red-700" };
  const threshold = item.reorder_level ?? lowStockThreshold;
  if (item.quantity_available <= threshold) return { key: "low_stock", label: "低库存", className: "bg-amber-50 text-amber-700" };
  return { key: "normal", label: "正常", className: "bg-emerald-50 text-emerald-700" };
}
function inventoryCsvStatus(item: InventoryItem, lowStockThreshold: number) {
  return inventoryStatusFor(item, lowStockThreshold).label;
}
const emptyQuickAdd: QuickAddState = {
  category: "men",
  subcategory: "tshirts",
  size_system: "letter",
  price: 0,
  stock: 1,
  sizes: "S,M,L",
  size_stock: "",
  color: "",
  brand: "",
  name_cn: "",
  name_gr: "",
  name_en: "",
  description_cn: "",
  description_gr: "",
  description_en: "",
  material: "",
  fit_type: "regular",
  ai_keywords: "",
  style_tags: "",
  notes: "",
  is_active: true,
};
const stockOperationOptions: Array<{
  key: StockOperationMode;
  label: string;
  shortDescription: string;
  guidance: string;
  quantityLabel: string;
  quantityPlaceholder: string;
  reason: string;
}> = [
  {
    key: "stocktake",
    label: "扫码盘点",
    shortDescription: "把系统库存修正为现场实数",
    guidance: "扫描商品后，填写这个尺码实际清点到的总件数。适合月末盘点或发现账实不符时修正。",
    quantityLabel: "实际清点数量",
    quantityPlaceholder: "填写现场实际总数",
    reason: "扫码盘点修正",
  },
  {
    key: "receiving",
    label: "到货扫码",
    shortDescription: "有条码直接扫，无条码先选规格并生成",
    guidance: "有条码的商品直接扫描；没有条码时输入商品名、商品 SKU、供货商 SKU 或款号，选择正确颜色和尺码。缺少内部 Barcode 的规格会先按 Variant SKU 安全生成，再增加库存。",
    quantityLabel: "本次到货数量",
    quantityPlaceholder: "填写本次增加件数",
    reason: "扫码到货入库",
  },
  {
    key: "return",
    label: "退换货加回",
    shortDescription: "把可再次销售的退货加回库存",
    guidance: "请先在真实收银机处理退款或换货，并确认商品可以再次销售，再在这里加回库存。",
    quantityLabel: "加回库存数量",
    quantityPlaceholder: "填写可重新销售件数",
    reason: "退换货库存加回",
  },
];

/* ── Utilities ───────────────────────────────────────────── */
function downloadCsv(filename: string, fields: string[], sample: Array<string | number | boolean>) {
  const csv = serializeCsv(fields, [sample]);
  const b = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
}
function downloadCsvTemplate() {
  const example: Partial<Record<(typeof PRODUCT_CSV_FIELDS)[number], string | number | boolean>> = {
    sku: "SKU-001",
    name_cn: "示例连衣裙",
    description_cn: "示例商品说明",
    name_en: "Example dress",
    description_en: "Example product description",
    name_gr: "Παράδειγμα φορέματος",
    description_gr: "Παράδειγμα περιγραφής προϊόντος",
    category: "women",
    subcategory: "dresses",
    price: 29.9,
    stock: 6,
    sizes: "S,M,L",
    size_system: "letter",
    size_stock: "S:2,M:3,L:1",
    brand: "Store Brand",
    vat: FIXED_PRODUCT_VAT_RATE,
    color: "black",
    is_active: true,
    material: "cotton",
    fit_type: "regular",
    ai_keywords: '["dress","summer","elegant"]',
    style_tags: '["casual","summer"]',
    size_chart: '{"S":{"bust":"84-88"},"M":{"bust":"88-92"}}',
    material_verified: true,
  };
  const sample = csvFields.map(field => example[field] ?? "");
  downloadCsv("products-template.csv", csvFields, sample);
}
function downloadQuickCsvTemplate() {
  const sample = ["SKU-001","示例商品","示例商品说明","women","dresses","29.90","10","S,M,L","letter","S:3,M:4,L:3","Store Brand","black","","","true"];
  downloadCsv("products-quick-template.csv", quickCsvFields, sample);
}
function cleanImageUrls(raw: string, mainUrl: string): string {
  const urls = raw.split(/[\r?\n,]+/).map(u => u.trim()).filter(u => u && u.length > 5 && u.startsWith("http"));
  const main = mainUrl.trim();
  // Dedup and remove main image URL from gallery
  const seen = new Set<string>();
  if (main) seen.add(main);
  return urls.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; }).join("\n");
}
function normalizeProduct(p: ProductFormData): ProductFormData {
  const img = p.image_url.trim();
  return { ...p, sku: p.sku.trim(), name_cn: p.name_cn.trim(), name_gr: p.name_gr.trim(), name_en: p.name_en.trim(), description_cn: p.description_cn.trim(), description_gr: p.description_gr.trim(), description_en: p.description_en.trim(), subcategory: p.subcategory.trim(), price: Number(p.price), stock: Number(p.stock), sizes: p.sizes.trim(), image_url: img, image_urls: cleanImageUrls(p.image_urls, img), brand: p.brand.trim(), barcode: p.barcode.trim(), vat: FIXED_PRODUCT_VAT_RATE, color: p.color.trim(), skroutz_url: p.skroutz_url.trim(), is_active: p.is_active, fit_type: p.fit_type, material: p.material.trim(), ai_keywords: p.ai_keywords.trim(), style_tags: p.style_tags.trim(), size_chart: p.size_chart.trim() };
}
function imageLines(v: string) { return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
function hasText(value: unknown) { return typeof value === "string" && value.trim().length > 0; }
function isHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { const url = new URL(value.trim()); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}
function isTestProductSku(sku: string) {
  const s = sku.trim().toUpperCase();
  return s === "TEST" || s.startsWith("TEST-") || s.startsWith("TEST_") || s === "DEMO" || s.startsWith("DEMO-") || s.startsWith("DEMO_");
}
function needsSizeInfo(product: AdminProduct) {
  return ["men", "women", "shoes"].includes(product.category.trim().toLowerCase());
}
function hasSizeStock(product: AdminProduct) {
  const ss = (product as Record<string, unknown>).size_stock;
  return Boolean(ss && typeof ss === "object" && !Array.isArray(ss) && Object.values(ss as Record<string, unknown>).some(v => Number(v) > 0));
}
function imageQualityIssue(product: AdminProduct) {
  if (!hasText(product.image_url)) return "缺主图";
  if (!isHttpUrl(product.image_url)) return "主图不是公网链接";
  const raw = product as Record<string, unknown>;
  const width = Number(raw.image_width) || 0;
  const height = Number(raw.image_height) || 0;
  if (!width && !height) return "未记录图片尺寸";
  if (width <= 1000 && height <= 1000) return `图片尺寸不足 ${width}×${height}`;
  return "";
}
function productIssues(product: AdminProduct) {
  const issues: { code: string; label: string; level: "block" | "warn" }[] = [];
  const stock = effectiveStock(product);
  const nameOk = hasText(product.name_gr) || hasText(product.name_en) || hasText(product.name_cn);
  const descOk = hasText(product.description_gr) || hasText(product.description_en) || hasText(product.description_cn);
  if (!hasText(product.sku)) issues.push({ code: "sku", label: "缺 SKU", level: "block" });
  if (isTestProductSku(product.sku)) issues.push({ code: "test", label: "测试 / Demo SKU，不建议正式上架", level: "block" });
  if (!product.is_active) issues.push({ code: "inactive", label: "未上架", level: "block" });
  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) issues.push({ code: "price", label: "价格无效", level: "block" });
  if (stock <= 0) issues.push({ code: "stock", label: "库存为 0", level: "block" });
  const imageIssue = imageQualityIssue(product);
  if (imageIssue === "缺主图" || imageIssue === "主图不是公网链接") issues.push({ code: "image", label: imageIssue, level: "block" });
  else if (imageIssue) issues.push({ code: "image-quality", label: imageIssue, level: "warn" });
  if (!nameOk) issues.push({ code: "name", label: "缺商品名", level: "block" });
  if (!descOk) issues.push({ code: "description", label: "缺描述", level: "warn" });
  if (!hasText(product.name_gr)) issues.push({ code: "name-gr", label: "缺希腊语名称", level: "warn" });
  if (!hasText(product.name_en)) issues.push({ code: "name-en", label: "缺英文名称", level: "warn" });
  if (!hasText(product.category)) issues.push({ code: "category", label: "缺一级分类", level: "block" });
  if (!hasText(product.subcategory)) issues.push({ code: "subcategory", label: "缺二级分类", level: "warn" });
  if (needsSizeInfo(product) && !hasText(product.sizes) && !hasSizeStock(product)) issues.push({ code: "sizes", label: "服装 / 鞋类缺尺码", level: "warn" });
  return issues;
}
function entersSkroutzFeed(product: AdminProduct) {
  return product.is_active && !isTestProductSku(product.sku) && skroutzReadinessIssues(product).length === 0;
}
function needsAiCompletion(product: AdminProduct) {
  const hasChinese = hasText(product.name_cn) || hasText(product.description_cn);
  const missingTranslation = hasChinese && (!hasText(product.name_en) || !hasText(product.description_en) || !hasText(product.name_gr) || !hasText(product.description_gr));
  const raw = product as Record<string, unknown>;
  const hasKeywords = Array.isArray(raw.ai_keywords) ? raw.ai_keywords.length > 0 : hasText(raw.ai_keywords);
  const hasStyleTags = Array.isArray(raw.style_tags) ? raw.style_tags.length > 0 : hasText(raw.style_tags);
  const missingMeta = (hasText(product.name_cn) || hasText(product.name_en) || hasText(product.name_gr)) && (!hasKeywords || !hasStyleTags);
  return missingTranslation || missingMeta;
}

function ProductStatusBadges({ product, showSkroutz, showAi }: { product: AdminProduct; showSkroutz: boolean; showAi: boolean }) {
  const raw = product as Record<string, unknown>;
  const width = Number(raw.image_width) || 0;
  const height = Number(raw.image_height) || 0;
  const hasImage = Boolean(product.image_url?.trim());
  const skroutzImageIssue = showSkroutz && hasImage && width <= 1000 && height <= 1000;

  const hasName = Boolean(product.name_en?.trim() || product.name_gr?.trim());
  const hasPrice = Number(product.price) > 0;
  const isSizedProduct = /women|men/i.test(product.category) || product.category === "shoes";
  const hasSizeChart = Boolean(raw.size_chart && typeof raw.size_chart === "object" && Object.keys(raw.size_chart as object).length > 0);
  const hasSizes = Boolean(product.sizes?.trim());
  const hasKeywords = (Array.isArray(raw.ai_keywords) && raw.ai_keywords.length > 0) || hasText(raw.ai_keywords);
  const hasStyleTags = (Array.isArray(raw.style_tags) && raw.style_tags.length > 0) || hasText(raw.style_tags);
  const materialOk = !hasText(raw.material) || raw.material_verified === true;
  const sizeInfoOk = !isSizedProduct || hasSizeChart || hasSizes;
  const basicsOk = hasName && hasImage && hasPrice && product.is_active && effectiveStock(product) > 0;
  const enhancedOk = hasKeywords && hasStyleTags && materialOk;
  const aiLevel: "complete" | "usable" | "incomplete" = basicsOk ? (enhancedOk && sizeInfoOk ? "complete" : "usable") : "incomplete";
  const aiColors = { complete: "bg-green-100 text-green-700", usable: "bg-blue-100 text-blue-700", incomplete: "bg-amber-100 text-amber-700" };
  const aiLabels = { complete: "AI 完整", usable: "AI 可用", incomplete: "AI 需补充" };

  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${product.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"}`}>
        {product.is_active ? "上架" : "下架"}
      </span>
      {skroutzImageIssue ? (
        <span className="inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" title={`主图 ${width}×${height} 不满足 Skroutz 最低要求（至少一边 > 1000px）`}>
          Skroutz 图片不符
        </span>
      ) : null}
      {showAi ? <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${aiColors[aiLevel]}`}>{aiLabels[aiLevel]}</span> : null}
    </div>
  );
}
/* ── Main component ──────────────────────────────────────── */
export function AdminDashboard({
  initialFeatures = defaultAdminFeatures,
  initialFeatureSettingsConfigured = false,
  initialPrintSettings,
}: {
  initialFeatures?: FeatureFlags;
  initialFeatureSettingsConfigured?: boolean;
  initialPrintSettings: BusinessSettings;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState(""); const [activePassword, setActivePassword] = useState("");
  const [loginMode, setLoginMode] = useState<"account" | "password">(initialFeatures.staff_accounts ? "account" : "password");
  const [loginEmail, setLoginEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [adminAuthToken, setAdminAuthToken] = useState("");
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [adminFeatures, setAdminFeatures] = useState<FeatureFlags>(initialFeatures);
  const [featureSettingsFallback, setFeatureSettingsFallback] = useState(!initialFeatureSettingsConfigured);
  const [commonTabKeys, setCommonTabKeys] = useState<Tab[]>(defaultCommonTabKeys);
  const [commonTabsReady, setCommonTabsReady] = useState(false);
  const [customizingCommonTabs, setCustomizingCommonTabs] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct); const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProductSnapshot, setEditingProductSnapshot] = useState<AdminProduct | null>(null);
  const [loading, setLoading] = useState(false); const [translating, setTranslating] = useState(false);
  const [aiMetaLoading, setAiMetaLoading] = useState(false);
  const [aiCopyLoading, setAiCopyLoading] = useState(false);
  const [aiQuickCopyLoading, setAiQuickCopyLoading] = useState(false);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const editingIdRef = useRef<string | null>(null); editingIdRef.current = editingId;
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvImportMode, setCsvImportMode] = useState<ProductCsvImportMode>("create_only");
  const [csvInventoryMode, setCsvInventoryMode] = useState<ProductCsvInventoryMode>("metadata_only");
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvPreviewError, setCsvPreviewError] = useState("");
  const [csvTranslations, setCsvTranslations] = useState<CsvTranslationResult[]>([]);
  const [csvTranslationFailures, setCsvTranslationFailures] = useState(0);
  const [csvJobView, setCsvJobView] = useState<CsvImportJobView | null>(null);
  const [csvHasPendingOperation, setCsvHasPendingOperation] = useState(false);
  const [csvBusy, setCsvBusy] = useState<"preview" | "translate" | "submit" | "process" | "retry" | "recover" | "download" | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const csvPreviewSequenceRef = useRef(0);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]); const [selectedImageSku, setSelectedImageSku] = useState("");
  const [tab, setTab] = useState<Tab>("stockLookup");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoCompletingId, setAutoCompletingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; desc: ReactNode; confirmText: string; variant: "danger"|"success"|"default"; action: () => void; prompt?: boolean; promptValue?: string }>({ open: false, title: "", desc: "", confirmText: "确认", variant: "default", action: () => {} });
  const [newMainFile, setNewMainFile] = useState<File | null>(null); const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [sizeStock, setSizeStock] = useState<Record<string, number>>({});
  const [variantMatrix, setVariantMatrix] = useState<ProductVariantMatrixRow[]>([]);
  const [variantProcurement, setVariantProcurement] = useState<Record<string, VariantProcurement>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showSizeSummary, setShowSizeSummary] = useState(false);
  const [quickAdd, setQuickAdd] = useState<QuickAddState>(emptyQuickAdd);
  const [quickMainFile, setQuickMainFile] = useState<File | null>(null);
  const [quickBackFiles, setQuickBackFiles] = useState<File[]>([]);
  const [quickSizeStock, setQuickSizeStock] = useState<Record<string, number>>({});
  const [quickVariantMatrix, setQuickVariantMatrix] = useState<ProductVariantMatrixRow[]>([]);
  const [quickSaving, setQuickSaving] = useState(false);
  const [sellingSku, setSellingSku] = useState<string | null>(null);
  const [styleImageSku, setStyleImageSku] = useState<string | null>(null);
  const [styleImageStyle, setStyleImageStyle] = useState("Mediterranean boutique look");
  const [styleImageModelType, setStyleImageModelType] = useState("adult fashion model");
  const [dbCats, setDbCats] = useState<Array<Record<string,unknown>>>([]);
  const [dbSubs, setDbSubs] = useState<Array<Record<string,unknown>>>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [inventoryReconciliation, setInventoryReconciliation] = useState<InventoryReconciliation | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("");
  const [inventorySubcategory, setInventorySubcategory] = useState("");
  const [inventoryQ, setInventoryQ] = useState("");
  const [inventorySize, setInventorySize] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState<InventoryStatusFilter>("all");
  const [inventorySort, setInventorySort] = useState<InventorySort>("stock_asc");
  const [lowStockThreshold, setLowStockThreshold] = useState(3);
  const stockLookupInputRef = useRef<HTMLInputElement | null>(null);
  const [stockLookupQuery, setStockLookupQuery] = useState("");
  const [stockLookupSize, setStockLookupSize] = useState("");
  const [stockLookupItems, setStockLookupItems] = useState<InventoryItem[]>([]);
  const [stockLookupLoading, setStockLookupLoading] = useState(false);
  const [stockLookupError, setStockLookupError] = useState("");
  const [stockLookupMessage, setStockLookupMessage] = useState("");
  const [stockLookupHasSearched, setStockLookupHasSearched] = useState(false);
  const stockOperationInputRef = useRef<HTMLInputElement | null>(null);
  const stockOperationQuantityRef = useRef<HTMLInputElement | null>(null);
  const [stockOperationMode, setStockOperationMode] = useState<StockOperationMode>("stocktake");
  const [stockOperationQuery, setStockOperationQuery] = useState("");
  const [stockOperationResults, setStockOperationResults] = useState<InventoryItem[]>([]);
  const [stockOperationItem, setStockOperationItem] = useState<InventoryItem | null>(null);
  const [stockOperationQuantity, setStockOperationQuantity] = useState("");
  const [stockOperationReference, setStockOperationReference] = useState("");
  const [stockOperationLoading, setStockOperationLoading] = useState(false);
  const [stockOperationSubmitting, setStockOperationSubmitting] = useState(false);
  const [stockOperationError, setStockOperationError] = useState("");
  const [stockOperationMessage, setStockOperationMessage] = useState("");
  const [movementVariantId, setMovementVariantId] = useState("");
  const [movementQ, setMovementQ] = useState("");
  const [movementType, setMovementType] = useState("");
  const [movementSourceType, setMovementSourceType] = useState("");
  const [movementLimit, setMovementLimit] = useState(50);
  const [adjustInventory, setAdjustInventory] = useState<InventoryAdjustState>({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" });
  const inventoryOperationIdsRef = useRef<InventoryOperationIdStore | null>(null);
  const quickSellOperationIdsRef = useRef<InventoryOperationIdStore | null>(null);
  const productOperationIdsRef = useRef<ProductOperationIdStore | null>(null);
  const csvOperationIdsRef = useRef<CsvImportOperationIdStore | null>(null);
  const [labelSearch, setLabelSearch] = useState("");
  const [labelCategory, setLabelCategory] = useState("");
  const [labelSubcategory, setLabelSubcategory] = useState("");
  const [labelProductId, setLabelProductId] = useState("");
  const [labelSizeFilter, setLabelSizeFilter] = useState("");
  const [labelStockFilter, setLabelStockFilter] = useState<LabelStockFilter>("all");
  const [labelOnlyMissingBarcode, setLabelOnlyMissingBarcode] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30");
  const [labelShowSupplierSku, setLabelShowSupplierSku] = useState(false);
  const [printLanguage, setPrintLanguage] = useState<PrintLanguage>("el");
  const [labelCopyCounts, setLabelCopyCounts] = useState<Record<string, number>>({});
  const [selectedLabelVariantIds, setSelectedLabelVariantIds] = useState<Set<string>>(new Set());
  const [labelGenerating, setLabelGenerating] = useState(false);
  const [labelMessage, setLabelMessage] = useState("");
  const [labelPreviewItems, setLabelPreviewItems] = useState<PrintableVariantLabel[] | null>(null);
  const labelVariantPanelRef = useRef<HTMLDivElement | null>(null);
  const posSearchInputRef = useRef<HTMLInputElement | null>(null);
  const posOperationIdsRef = useRef<PosOperationIdStore | null>(null);
  const [posQuery, setPosQuery] = useState("");
  const [posResults, setPosResults] = useState<PosSearchItem[]>([]);
  const [posCart, setPosCart] = useState<PosCartItem[]>([]);
  const [posPaymentMethod, setPosPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [posDiscountTotal, setPosDiscountTotal] = useState("0");
  const [posLoading, setPosLoading] = useState(false);
  const [posCheckoutLoading, setPosCheckoutLoading] = useState(false);
  const [posMessage, setPosMessage] = useState("");
  const [posRuntimeIssue, setPosRuntimeIssue] = useState("");
  const [posPreview, setPosPreview] = useState<Record<string, unknown> | null>(null);
  const [posLastOrder, setPosLastOrder] = useState<PosOrderResult | null>(null);
  const [posView, setPosView] = useState<PosOrdersView>("checkout");
  const [posOrders, setPosOrders] = useState<PosOrderListItem[]>([]);
  const [posOrdersTotal, setPosOrdersTotal] = useState(0);
  const [posOrdersOffset, setPosOrdersOffset] = useState(0);
  const [posOrdersLoading, setPosOrdersLoading] = useState(false);
  const [posOrdersMessage, setPosOrdersMessage] = useState("");
  const [posOrderQ, setPosOrderQ] = useState("");
  const [posOrderStatus, setPosOrderStatus] = useState<PosOrderStatusFilter>("all");
  const [posOrderPaymentMethod, setPosOrderPaymentMethod] = useState<PosPaymentFilter>("all");
  const [posOrderDateRange, setPosOrderDateRange] = useState<PosDateRangeFilter>("today");
  const [posOrderDetail, setPosOrderDetail] = useState<PosOrderDetail | null>(null);
  const [posOrderDetailLoading, setPosOrderDetailLoading] = useState(false);
  const [posVoidDialog, setPosVoidDialog] = useState<PosVoidDialogState | null>(null);
  const [posReceiptDetail, setPosReceiptDetail] = useState<PosOrderDetail | null>(null);
  const [posReceiptLoading, setPosReceiptLoading] = useState(false);
  const [posDailyDate, setPosDailyDate] = useState(() => formatAthensBusinessDate());
  const [posDailyReport, setPosDailyReport] = useState<PosDailyReport | null>(null);
  const [posDailyOffset, setPosDailyOffset] = useState(0);
  const [posDailyLoading, setPosDailyLoading] = useState(false);
  const [posDailyMessage, setPosDailyMessage] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(adminCommonTabsStorageKey);
      if (saved) setCommonTabKeys(normalizeCommonTabKeys(JSON.parse(saved)));
    } catch {
      setCommonTabKeys(defaultCommonTabKeys);
    } finally {
      setCommonTabsReady(true);
    }
  }, []);
  useEffect(() => {
    if (!commonTabsReady) return;
    try {
      window.localStorage.setItem(adminCommonTabsStorageKey, JSON.stringify(commonTabKeys));
    } catch {
      // Browsers with blocked storage can still use the customization for the current page session.
    }
  }, [commonTabKeys, commonTabsReady]);
  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    if (!supabase) return;
    let active = true;
    let generation = 0;

    const applyAccountSession = async (event: string, session: { access_token?: string } | null) => {
      const update = tokenUpdateForSupabaseAuthEvent(event, session);
      if (update.kind === "ignore") return;
      const requestGeneration = ++generation;
      if (update.kind === "clear") {
        setAdminAuthToken("");
        setAdminSession(null);
        return;
      }
      setAdminAuthToken(update.token);
      setActivePassword("");
      const response = await fetch("/api/admin/session", {
        headers: { Authorization: `Bearer ${update.token}` },
      }).catch(() => null);
      if (!active || requestGeneration !== generation) return;
      if (!response?.ok) {
        setAdminAuthToken("");
        setAdminSession(null);
        return;
      }
      const data = await response.json().catch(() => null);
      if (!active || requestGeneration !== generation || !data) return;
      setAdminSession({
        role: data.role,
        permissions: data.permissions || [],
        authType: "account",
        email: data.email || null,
        displayName: data.displayName || null,
      });
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      void applyAccountSession(event, session);
    });
    void supabase.auth.getSession().then(({ data }) => applyAccountSession("INITIAL_SESSION", data.session));
    return () => {
      active = false;
      generation += 1;
      listener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => { if (adminSession) { fetch("/api/admin/categories", { headers: adminAuthHeaders() }).then(r => r.json()).then(d => { setDbCats((d.categories||[]).filter((c:Record<string,unknown>) => c.is_active !== false)); setDbSubs((d.subcategories||[]).filter((s:Record<string,unknown>) => s.is_active !== false)); }).catch(() => {}); } }, [adminSession, adminAuthToken, activePassword, tab]);
  useEffect(() => {
    if (!adminSession) return;
    fetch("/api/admin/features", { headers: adminAuthHeaders() })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("功能配置读取失败")))
      .then((data) => {
        const configured = data.settings?.configured === true;
        setAdminFeatures(configured ? (data.settings?.features || defaultAdminFeatures) : defaultAdminFeatures);
        setFeatureSettingsFallback(!configured);
      })
      .catch(() => {
        setAdminFeatures(defaultAdminFeatures);
        setFeatureSettingsFallback(true);
      });
  }, [adminSession, adminAuthToken, activePassword]);
  useEffect(() => {
    if (!adminSession || !adminFeatures.pos_checkout || !adminSession.permissions.includes("pos:read")) {
      setPosRuntimeIssue("");
      return;
    }
    fetch("/api/admin/pos/health", { headers: adminAuthHeaders() })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ready !== true) {
          throw new Error(data.error || "POS 事务 RPC 未就绪，销售写入已阻断。");
        }
        setPosRuntimeIssue("");
      })
      .catch(error => setPosRuntimeIssue(error instanceof Error ? error.message : "POS 事务 RPC 未就绪，销售写入已阻断。"));
  }, [adminSession, adminAuthToken, activePassword, adminFeatures.pos_checkout]);

  // Search / filter state
  const [search, setSearch] = useState(""); const [filterCat, setFilterCat] = useState(""); const [filterSub, setFilterSub] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | active | inactive | noimg | badimage | nostock | nosizestock | demo
  const [mobileProductLimit, setMobileProductLimit] = useState(12);
  const hasPermission = (permission: AdminPermission) => Boolean(adminSession?.permissions.includes(permission));
  const isOwner = adminSession?.role === "owner";
  const canReadProcurement = hasPermission("procurement:read");
  const canReadProcurementCost = hasPermission("procurement:cost");
  const adminCategoryOptions: Array<Record<string, unknown>> = dbCats.length > 0
    ? dbCats
    : categories.map(category => ({ id: category.slug, slug: category.slug, name_cn: fallbackCategoryNamesCn[category.slug] || category.slug }));
  const categoryOptionLabel = (category: Record<string, unknown>) => {
    const slug = String(category.slug || "");
    const chineseName = String(category.name_cn || fallbackCategoryNamesCn[slug] || "");
    return chineseName && chineseName !== slug ? `${slug} · ${chineseName}` : slug;
  };
  const subcategoryOptionLabel = (subcategory: Record<string, unknown>) => {
    const slug = String(subcategory.slug || "");
    const chineseName = String(subcategory.name_cn || fallbackSubcategoryNamesCn[slug] || "");
    return chineseName && chineseName !== slug ? `${slug} · ${chineseName}` : slug;
  };
  const adminSubcategoryOptions = (categorySlug: string): Array<Record<string, unknown>> => {
    if (dbCats.length > 0) {
      const category = dbCats.find(item => String(item.slug) === categorySlug);
      if (!category) return [];
      return dbSubs.filter(item => String(item.category_id) === String(category.id));
    }
    return (subcategoryList[categorySlug] || []).map(slug => ({ slug, name_cn: fallbackSubcategoryNamesCn[slug] || slug }));
  };
  const categoryDisplayLabel = (categorySlug: string) => {
    if (!categorySlug) return "无分类";
    const category = adminCategoryOptions.find(item => String(item.slug) === categorySlug) || { slug: categorySlug };
    return categoryOptionLabel(category);
  };
  const subcategoryDisplayLabel = (categorySlug: string, subcategorySlug: string) => {
    if (!subcategorySlug) return "无二级分类";
    const subcategory = adminSubcategoryOptions(categorySlug).find(item => String(item.slug) === subcategorySlug) || { slug: subcategorySlug };
    return subcategoryOptionLabel(subcategory);
  };
  const categoryPathDisplayLabel = (categorySlug: string, subcategorySlug: string) => `${categoryDisplayLabel(categorySlug)} / ${subcategoryDisplayLabel(categorySlug, subcategorySlug)}`;
  const canUseTab = (key: Tab) => {
    if (!adminSession) return false;
    const feature = tabFeatures[key];
    if (feature && !adminFeatures[feature]) return false;
    if (ownerOnlyTabs.has(key)) return isOwner;
    const permission = tabPermissions[key];
    return permission ? hasPermission(permission) : isOwner;
  };
  const commonTabKeySet = new Set(commonTabKeys);
  const visibleCommonTabKeys = commonTabKeys.filter(canUseTab);
  const visibleAdvancedTabKeys = allTabKeys.filter(key => !commonTabKeySet.has(key) && canUseTab(key));
  const addCommonTab = (key: Tab) => setCommonTabKeys(current => current.includes(key) ? current : [...current, key]);
  const removeCommonTab = (key: Tab) => {
    if (visibleCommonTabKeys.length <= 1 && canUseTab(key)) {
      toast("常用操作至少保留一项", "err");
      return;
    }
    setCommonTabKeys(current => current.filter(item => item !== key));
  };
  const moveCommonTab = (key: Tab, direction: -1 | 1) => {
    setCommonTabKeys(current => {
      const index = current.indexOf(key);
      if (index < 0) return current;
      let target = index + direction;
      while (target >= 0 && target < current.length && !canUseTab(current[target])) target += direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const resetCommonTabs = () => setCommonTabKeys(defaultCommonTabKeys);
  const activeStockOperation = stockOperationOptions.find(option => option.key === stockOperationMode)!;
  useEffect(() => {
    if (!adminSession) return;
    if (canUseTab(tab)) return;
    const nextTab = visibleCommonTabKeys[0] || visibleAdvancedTabKeys[0] || "dashboard";
    setTab(nextTab);
  }, [adminSession, adminFeatures, tab, visibleCommonTabKeys, visibleAdvancedTabKeys]);
  useEffect(() => {
    if (tab !== "pos") return;
    const compactViewport = window.matchMedia("(max-width: 1279px)");
    const leaveDesktopOnlyPos = () => {
      if (!compactViewport.matches) return;
      const nextTab = visibleCommonTabKeys.find(key => !desktopOnlyTabs.has(key))
        || visibleAdvancedTabKeys.find(key => !desktopOnlyTabs.has(key))
        || "dashboard";
      setTab(nextTab);
    };
    leaveDesktopOnlyPos();
    compactViewport.addEventListener("change", leaveDesktopOnlyPos);
    return () => compactViewport.removeEventListener("change", leaveDesktopOnlyPos);
  }, [tab, visibleCommonTabKeys, visibleAdvancedTabKeys]);

  const csvSummary = useMemo(() => {
    if (!csvPreview) return { valid: 0, invalid: 0, needsTranslation: 0 };
    const translationsByRow = new Map(csvTranslations.map(result => [result.rowNumber, result]));
    const needsTranslation = csvPreview.rows.filter(row => {
      const translated = translationsByRow.get(row.rowNumber);
      const sourceName = String(row.metadata.name_cn || "").trim();
      const sourceDescription = String(row.metadata.description_cn || "").trim();
      if (!sourceName && !sourceDescription) return false;
      return !String(translated?.translated ? translated.name_en : row.metadata.name_en || "").trim()
        || !String(translated?.translated ? translated.description_en : row.metadata.description_en || "").trim()
        || !String(translated?.translated ? translated.name_gr : row.metadata.name_gr || "").trim()
        || !String(translated?.translated ? translated.description_gr : row.metadata.description_gr || "").trim();
    }).length;
    return { valid: csvPreview.rowCount, invalid: 0, needsTranslation };
  }, [csvPreview, csvTranslations]);
  const csvPreviewResults = useMemo<ApiResult[]>(() => {
    const translationsByRow = new Map(csvTranslations.map(result => [result.rowNumber, result]));
    return (csvPreview?.rows || []).map(row => {
      const translation = translationsByRow.get(row.rowNumber);
      const finalNameEn = String(translation?.translated ? translation.name_en : row.metadata.name_en || "").trim();
      const finalDescriptionEn = String(translation?.translated ? translation.description_en : row.metadata.description_en || "").trim();
      const finalNameGr = String(translation?.translated ? translation.name_gr : row.metadata.name_gr || "").trim();
      const finalDescriptionGr = String(translation?.translated ? translation.description_gr : row.metadata.description_gr || "").trim();
      return {
        rowNumber: row.rowNumber,
        sku: row.sku,
        ok: true,
        translated: translation?.translated === true,
        translateError: translation?.translateError,
        statusLabel: translation?.translated ? "最终译文已冻结" : translation?.translateError ? "翻译失败，保留原值" : "已校验",
        statusTone: "info" as const,
        message: [
          `${String(row.metadata.category || "-")} / ${String(row.metadata.subcategory || "-")}，${row.variants.length} 个 Variant`,
          `英文：${finalNameEn || "未填写"}${finalDescriptionEn ? `｜${finalDescriptionEn}` : ""}`,
          `希腊语：${finalNameGr || "未填写"}${finalDescriptionGr ? `｜${finalDescriptionGr}` : ""}`,
        ].join("；"),
      };
    });
  }, [csvPreview, csvTranslations]);
  const csvJobResults = useMemo<ApiResult[]>(() => (csvJobView?.rows || []).map(row => {
    const statusTone: ApiResult["statusTone"] = row.status === "succeeded"
      ? "success"
      : row.status === "failed" ? "error" : "pending";
    const statusLabel = row.status === "succeeded"
      ? "成功"
      : row.status === "failed" ? "失败" : row.status === "processing" ? "处理中" : "待处理";
    const action = typeof row.result_snapshot?.action === "string" ? `，${row.result_snapshot.action}` : "";
    return {
      rowNumber: row.row_number,
      sku: row.normalized_sku,
      ok: row.status === "succeeded",
      statusLabel,
      statusTone,
      message: row.error_summary || `${statusLabel}${action}${row.attempt_count > 0 ? `，尝试 ${row.attempt_count} 次` : ""}`,
    };
  }), [csvJobView]);
  const csvRetryableFailures = useMemo(
    () => (csvJobView?.rows || []).filter(row => row.status === "failed" && row.retryable).length,
    [csvJobView],
  );

  // Stats
  const stats = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    const noSizeStock = products.filter(p => p.sizes.trim() && !(p as Record<string,unknown>).size_stock || (typeof (p as Record<string,unknown>).size_stock === "object" && Object.keys((p as Record<string,unknown>).size_stock as object).length === 0)).length;
    return { total: products.length, active: products.filter(p => p.is_active).length, noImage: products.filter(p => !p.image_url).length, noStock: products.filter(p => effectiveStock(p) === 0).length, noSizeStock, categories: cats.size };
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (search) { const q = search.toLowerCase(); list = list.filter(p => p.sku.toLowerCase().includes(q) || p.name_cn.toLowerCase().includes(q) || p.name_en.toLowerCase().includes(q) || p.name_gr.toLowerCase().includes(q)); }
    if (filterCat) list = list.filter(p => p.category === filterCat);
    if (filterSub) list = list.filter(p => p.subcategory === filterSub);
    if (filterStatus === "active") list = list.filter(p => p.is_active);
    if (filterStatus === "inactive") list = list.filter(p => !p.is_active);
    if (filterStatus === "noimg") list = list.filter(p => !p.image_url);
    if (filterStatus === "badimage") list = list.filter(p => {
      const issue = imageQualityIssue(p);
      return Boolean(issue && issue !== "缺主图");
    });
    if (filterStatus === "nostock") list = list.filter(p => effectiveStock(p) === 0);
    if (filterStatus === "nosizestock") list = list.filter(p => p.sizes.trim() && !((p as Record<string,unknown>).size_stock && typeof (p as Record<string,unknown>).size_stock === "object" && Object.keys((p as Record<string,unknown>).size_stock as object).length > 0));
    if (filterStatus === "nodesc") list = list.filter(p => !p.description_en?.trim() && !p.description_gr?.trim());
    if (filterStatus === "demo") list = list.filter(p => /TEST|DEMO/i.test(p.sku));
    return list;
  }, [products, search, filterCat, filterSub, filterStatus]);

  useEffect(() => {
    setMobileProductLimit(12);
  }, [search, filterCat, filterSub, filterStatus]);

  // Feed stats
  const feedStats = useMemo(() => {
    const activeRealProducts = products.filter(p => p.is_active && !isTestProductSku(p.sku));
    const stockReady = activeRealProducts.filter(p => effectiveStock(p) > 0);
    return {
      total: activeRealProducts.filter(entersSkroutzFeed).length,
      noImage: stockReady.filter(p => !isHttpUrl(p.image_url)).length,
      noDesc: stockReady.filter(p => !p.description_en && !p.description_gr && !p.description_cn).length,
      noStock: activeRealProducts.filter(p => effectiveStock(p) <= 0).length,
      missingRequired: stockReady.filter(p => skroutzReadinessIssues(p).length > 0).length,
      testHidden: products.filter(p => p.is_active && isTestProductSku(p.sku)).length,
    };
  }, [products]);

  const productsById = useMemo(() => {
    return new Map(products.map(product => [Number(product.id), product]));
  }, [products]);

  const stockOperationProduct = stockOperationItem
    ? productsById.get(stockOperationItem.product_id)
    : undefined;
  const stockOperationBarcodePlan = getStockOperationBarcodePlan({
    mode: stockOperationMode,
    barcode: stockOperationItem?.barcode,
    barcodeFeatureEnabled: adminFeatures.barcode_labels,
  });

  const filteredInventoryItems = useMemo(() => {
    const threshold = Math.max(0, Math.trunc(lowStockThreshold) || 0);
    const query = inventoryQ.trim().toLowerCase();
    const size = inventorySize.trim().toUpperCase();
    let list = inventoryItems.filter(item => {
      const product = productsById.get(item.product_id);
      const category = item.category || product?.category || "";
      const subcategory = item.subcategory || product?.subcategory || "";
      if (inventoryCategory && category !== inventoryCategory) return false;
      if (inventorySubcategory && subcategory !== inventorySubcategory) return false;
      if (inventoryStatus !== "all" && inventoryStatusFor(item, threshold).key !== inventoryStatus) return false;
      if (size && (item.size || "").trim().toUpperCase() !== size) return false;
      if (query && ![
        item.product_name,
        item.product_sku,
        item.variant_sku,
        item.barcode,
        item.supplier_sku,
        item.supplier_name,
        item.supplier_style_code,
        item.color,
        item.size,
      ].some(value => String(value || "").toLowerCase().includes(query))) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (inventorySort === "stock_desc") return b.quantity_available - a.quantity_available;
      if (inventorySort === "sku") return `${a.product_sku}-${a.variant_sku}`.localeCompare(`${b.product_sku}-${b.variant_sku}`);
      return a.quantity_available - b.quantity_available;
    });
    return list;
  }, [inventoryItems, productsById, inventoryCategory, inventorySubcategory, inventoryQ, inventorySize, inventoryStatus, inventorySort, lowStockThreshold]);

  const inventorySummary = useMemo(() => {
    const threshold = Math.max(0, Math.trunc(lowStockThreshold) || 0);
    return filteredInventoryItems.reduce((summary, item) => {
      const status = inventoryStatusFor(item, threshold).key;
      summary.totalVariants += 1;
      summary.totalOnHand += item.quantity_on_hand;
      summary.totalAvailable += item.quantity_available;
      if (status === "out_of_stock") summary.outOfStock += 1;
      if (status === "low_stock") summary.lowStock += 1;
      if (status === "inactive") summary.inactive += 1;
      if (status === "mismatch") summary.mismatch += 1;
      return summary;
    }, { totalVariants: 0, totalOnHand: 0, totalAvailable: 0, outOfStock: 0, lowStock: 0, inactive: 0, mismatch: 0 });
  }, [filteredInventoryItems, lowStockThreshold]);

  const stockLookupGroups = useMemo(() => {
    const groups = new Map<number, StockLookupGroup>();
    for (const item of stockLookupItems) {
      const existing = groups.get(item.product_id);
      if (existing) {
        existing.items.push(item);
        existing.totalAvailable += item.quantity_available;
        continue;
      }
      const product = productsById.get(item.product_id);
      groups.set(item.product_id, {
        productId: item.product_id,
        productName: item.product_name || item.product_sku,
        productSku: item.product_sku,
        imageUrl: product?.image_url || "",
        totalAvailable: item.quantity_available,
        items: [item],
      });
    }
    return Array.from(groups.values()).map(group => {
      const sizeOrder = sortSizeKeys(Array.from(new Set(group.items.map(item => item.size || "ONE SIZE"))));
      group.items.sort((left, right) => {
        const sizeDifference = sizeOrder.indexOf(left.size || "ONE SIZE") - sizeOrder.indexOf(right.size || "ONE SIZE");
        return sizeDifference || (left.color || "").localeCompare(right.color || "");
      });
      return group;
    });
  }, [stockLookupItems, productsById]);

  const labelProductGroups = useMemo(() => {
    const groups = new Map<number, LabelProductGroup>();
    for (const item of inventoryItems) {
      const existing = groups.get(item.product_id);
      if (existing) {
        existing.items.push(item);
        continue;
      }
      const product = productsById.get(item.product_id);
      groups.set(item.product_id, {
        productId: item.product_id,
        productName: item.product_name || item.product_sku,
        productSku: item.product_sku,
        imageUrl: product?.image_url || "",
        category: product?.category || "",
        subcategory: product?.subcategory || "",
        items: [item],
      });
    }
    return Array.from(groups.values())
      .map(group => {
        const sizeOrder = sortSizeKeys(Array.from(new Set(group.items.map(item => item.size || "ONE SIZE"))));
        group.items.sort((left, right) => {
          const sizeDifference = sizeOrder.indexOf(left.size || "ONE SIZE") - sizeOrder.indexOf(right.size || "ONE SIZE");
          return sizeDifference || (left.color || "").localeCompare(right.color || "") || left.variant_sku.localeCompare(right.variant_sku);
        });
        return group;
      })
      .sort((left, right) => left.productName.localeCompare(right.productName, "zh-CN") || left.productSku.localeCompare(right.productSku));
  }, [inventoryItems, productsById]);

  const labelProductOptions = useMemo(() => {
    const query = labelSearch.trim().toLowerCase();
    return labelProductGroups.filter(group => {
      if (labelCategory && group.category !== labelCategory) return false;
      if (labelSubcategory && group.subcategory !== labelSubcategory) return false;
      if (!query) return true;
      if (`${group.productName} ${group.productSku}`.toLowerCase().includes(query)) return true;
      return group.items.some(item => [item.variant_sku, item.barcode, item.supplier_sku, item.size, item.color]
        .some(value => String(value || "").toLowerCase().includes(query)));
    });
  }, [labelProductGroups, labelSearch, labelCategory, labelSubcategory]);

  const selectedLabelProduct = useMemo(() => {
    return labelProductGroups.find(group => String(group.productId) === labelProductId) || null;
  }, [labelProductGroups, labelProductId]);

  const labelAvailableSizes = useMemo(() => {
    return sortSizeKeys(Array.from(new Set(labelProductOptions.flatMap(group => group.items.map(item => item.size || "ONE SIZE")))));
  }, [labelProductOptions]);

  const visibleLabelItems = useMemo(() => {
    return labelProductOptions.flatMap(group => group.items).filter(item => {
      if (labelSizeFilter && (item.size || "ONE SIZE") !== labelSizeFilter) return false;
      if (labelOnlyMissingBarcode && barcodeIsPresent(item.barcode)) return false;
      if (labelStockFilter === "in_stock" && item.quantity_on_hand <= 0) return false;
      if (labelStockFilter === "out_of_stock" && item.quantity_on_hand > 0) return false;
      return true;
    });
  }, [labelProductOptions, labelSizeFilter, labelOnlyMissingBarcode, labelStockFilter]);

  const visibleLabelVariantIds = useMemo(() => new Set(visibleLabelItems.map(item => item.variant_id)), [visibleLabelItems]);

  const visibleLabelProductGroups = useMemo(() => {
    return labelProductOptions
      .map(group => ({ ...group, items: group.items.filter(item => visibleLabelVariantIds.has(item.variant_id)) }))
      .filter(group => group.items.length > 0);
  }, [labelProductOptions, visibleLabelVariantIds]);

  const filteredLabelItems = useMemo(() => {
    if (!selectedLabelProduct) return [];
    return selectedLabelProduct.items.filter(item => visibleLabelVariantIds.has(item.variant_id));
  }, [selectedLabelProduct, visibleLabelVariantIds]);

  const selectedLabelItems = useMemo(() => {
    return inventoryItems.filter(item => selectedLabelVariantIds.has(item.variant_id));
  }, [inventoryItems, selectedLabelVariantIds]);

  const selectedLabelCopies = useMemo(() => {
    return selectedLabelItems.reduce(
      (sum, item) => sum + normalizeLabelCopies(labelCopyCounts[item.variant_id], item.quantity_on_hand),
      0,
    );
  }, [selectedLabelItems, labelCopyCounts]);

  const labelSelectionSummary = useMemo(() => getBarcodeLabelSelectionSummary({
    visibleItems: visibleLabelItems,
    allItems: inventoryItems,
    selectedVariantIds: selectedLabelVariantIds,
    copyCounts: labelCopyCounts,
  }), [visibleLabelItems, inventoryItems, selectedLabelVariantIds, labelCopyCounts]);

  const selectedMissingBarcodeItems = useMemo(
    () => selectedLabelItems.filter(item => !barcodeIsPresent(item.barcode)),
    [selectedLabelItems],
  );
  useEffect(() => {
    if (labelSelectionSummary.allMissingBarcodeCount === 0 && labelOnlyMissingBarcode) {
      setLabelOnlyMissingBarcode(false);
    }
  }, [labelSelectionSummary.allMissingBarcodeCount, labelOnlyMissingBarcode]);

  const selectedLabelGroups = useMemo(() => {
    return labelProductGroups
      .map(group => ({ ...group, items: group.items.filter(item => selectedLabelVariantIds.has(item.variant_id)) }))
      .filter(group => group.items.length > 0);
  }, [labelProductGroups, selectedLabelVariantIds]);

  const posSubtotal = useMemo(() => {
    return posCart.reduce((sum, item) => sum + item.price * item.cartQuantity, 0);
  }, [posCart]);
  const posDiscount = useMemo(() => Math.max(0, Number(posDiscountTotal) || 0), [posDiscountTotal]);
  const posTotal = useMemo(() => Math.max(0, posSubtotal - posDiscount), [posSubtotal, posDiscount]);

  const launchChecks = useMemo(() => {
    const rows = products.map(product => {
      const issues = productIssues(product);
      const blockers = issues.filter(issue => issue.level === "block");
      const warnings = issues.filter(issue => issue.level === "warn");
      return { product, issues, blockers, warnings, feedReady: entersSkroutzFeed(product), siteReady: product.is_active && blockers.length === 0 };
    });
    return {
      rows,
      siteReady: rows.filter(row => row.siteReady).length,
      feedReady: rows.filter(row => row.feedReady).length,
      issueCount: rows.filter(row => row.issues.length > 0).length,
      blockers: rows.filter(row => row.blockers.length > 0).length,
      warnings: rows.filter(row => row.blockers.length === 0 && row.warnings.length > 0).length,
      imageIssues: rows.filter(row => row.issues.some(issue => issue.code === "image" || issue.code === "image-quality")).length,
      aiCompletable: rows.filter(row => needsAiCompletion(row.product)).length,
    };
  }, [products]);

  function downloadLaunchCheckReport() {
    const headers = ["sku", "name", "category", "subcategory", "status", ...(adminFeatures.skroutz_feed ? ["feed_status"] : []), "stock", "price", "image_url", "issues"];
    const rows = launchChecks.rows
      .filter(row => row.issues.length > 0)
      .map(({ product, issues, blockers, feedReady }) => [
        product.sku,
        product.name_cn || product.name_en || product.name_gr || "",
        product.category || "",
        product.subcategory || "",
        blockers.length > 0 ? "blocked" : "needs_review",
        ...(adminFeatures.skroutz_feed ? [feedReady ? "feed_ready" : "not_in_feed"] : []),
        String(effectiveStock(product)),
        String(product.price ?? ""),
        product.image_url || "",
        issues.map(issue => issue.label).join("；"),
      ]);
    const csv = serializeCsv(headers, rows);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `launch-check-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadInventoryCsv() {
    const headers = [
      "product_id",
      "product_name",
      "product_sku",
      "variant_id",
      "variant_sku",
      "size",
      "color",
      "barcode",
      ...(canReadProcurement ? ["supplier_name", "supplier_style_code", "supplier_sku", "reorder_level"] : []),
      ...(canReadProcurementCost ? ["cost_price"] : []),
      "active",
      "quantity_on_hand",
      "quantity_reserved",
      "quantity_available",
      "stock_status",
      "reconciliation_status",
    ];
    const rows = filteredInventoryItems.map(item => [
      String(item.product_id),
      item.product_name || "",
      item.product_sku || "",
      item.variant_id,
      item.variant_sku || "",
      item.size || "",
      item.color || "",
      item.barcode || "",
      ...(canReadProcurement ? [
        item.supplier_name || "",
        item.supplier_style_code || "",
        item.supplier_sku || "",
        item.reorder_level == null ? "" : String(item.reorder_level),
      ] : []),
      ...(canReadProcurementCost ? [item.cost_price == null ? "" : String(item.cost_price)] : []),
      item.active ? "TRUE" : "FALSE",
      String(item.quantity_on_hand),
      String(item.quantity_reserved),
      String(item.quantity_available),
      inventoryCsvStatus(item, lowStockThreshold),
      item.stock_matches_legacy && item.size_stock_matches_legacy ? "OK" : "MISMATCH",
    ]);
    const csv = serializeCsv(headers, rows);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `erp-inventory-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /* ── API helper ───────────────────────────────────────── */
  function adminAuthHeaders(): Record<string, string> {
    if (adminAuthToken) return { Authorization: `Bearer ${adminAuthToken}` };
    return activePassword ? { "x-admin-password": activePassword } : {};
  }

  async function api(path: string, init: RequestInit = {}): Promise<any> {
    const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...adminAuthHeaders(), ...(init.headers || {}) } });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 401 && adminSession?.authType === "account") void logoutAdmin();
    if (!r.ok) throw new AdminApiError(typeof d.error === "string" ? d.error : "Request failed", r.status, d);
    return d;
  }
  async function readJson(r: Response, fallback: string) { const ct = r.headers.get("Content-Type")||""; if (ct.includes("json")) return r.json(); const t = await r.text(); throw new Error(t ? `${fallback}: ${t.slice(0, 160)}` : fallback); }
  async function generateProductCopyRequest(product: Record<string, unknown>, images: File[]) {
    const formData = new FormData();
    formData.append("product", JSON.stringify(product));
    images.slice(0, maxProductVisionImages).forEach(file => formData.append("images", file));
    const response = await fetch("/api/admin/generate-product-copy", {
      method: "POST",
      headers: adminAuthHeaders(),
      body: formData,
    });
    const data = await readJson(response, "AI 商品资料接口错误") as Record<string, unknown>;
    if (response.status === 401 && adminSession?.authType === "account") void logoutAdmin();
    if (!response.ok) throw new AdminApiError(typeof data.error === "string" ? data.error : "AI 商品资料生成失败", response.status, data);
    return data as ProductCopyResult;
  }

  function posErrorMessage(data: Record<string, unknown>, fallback: string) {
    if (data.variant_sku && data.requested !== undefined && data.available !== undefined) {
      return `${data.error || fallback} ${data.variant_sku}：需要 ${data.requested}，可用 ${data.available}`;
    }
    if (data.sku || data.variant_sku) {
      return `${data.error || fallback} ${data.sku || ""} ${data.variant_sku || ""}`.trim();
    }
    return String(data.error || fallback);
  }

  async function posApi(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...adminAuthHeaders(), ...(init.headers || {}) },
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(posErrorMessage(data, "POS 请求失败"));
    return data;
  }

  function posOperationIds() {
    if (!posOperationIdsRef.current) {
      posOperationIdsRef.current = new PosOperationIdStore(window.sessionStorage);
    }
    return posOperationIdsRef.current;
  }

  function inventoryOperationIds() {
    if (!inventoryOperationIdsRef.current) {
      inventoryOperationIdsRef.current = new InventoryOperationIdStore("inventory", window.sessionStorage);
    }
    return inventoryOperationIdsRef.current;
  }

  function quickSellOperationIds() {
    if (!quickSellOperationIdsRef.current) {
      quickSellOperationIdsRef.current = new InventoryOperationIdStore("quick-sell", window.sessionStorage);
    }
    return quickSellOperationIdsRef.current;
  }

  function productOperationIds() {
    if (!productOperationIdsRef.current) {
      productOperationIdsRef.current = new ProductOperationIdStore("product", window.sessionStorage);
    }
    return productOperationIdsRef.current;
  }

  function csvOperationIds() {
    if (!csvOperationIdsRef.current) {
      csvOperationIdsRef.current = new CsvImportOperationIdStore("products-csv", window.sessionStorage);
    }
    return csvOperationIdsRef.current;
  }

  function csvTranslationPayload() {
    return csvTranslations
      .filter(result => result.translated)
      .map(({ rowNumber, name_en, description_en, name_gr, description_gr }) => ({
        rowNumber,
        name_en,
        description_en,
        name_gr,
        description_gr,
      }));
  }

  function csvOperationFingerprint() {
    if (!csvPreview) throw new Error("请先完成服务端 CSV 预览。");
    return createCsvImportFingerprint({
      fileHash: csvPreview.fileHash,
      importMode: csvImportMode,
      inventoryMode: csvInventoryMode,
      translations: csvTranslationPayload(),
    });
  }

  async function csvFetchJson(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(path, {
        ...init,
        headers: { ...adminAuthHeaders(), ...(init.headers || {}) },
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new AdminApiError(
          typeof data.error === "string" ? data.error : "CSV 请求失败",
          response.status,
          data,
        );
      }
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("CSV 请求超时；如果已经提交导入，请使用原业务 ID 恢复 Job 状态。");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function clearCompletedCsvForm(operationId?: string) {
    if (operationId) csvOperationIds().complete(operationId);
    setCsvHasPendingOperation(false);
    setCsvFile(null);
    setCsvPreview(null);
    setCsvTranslations([]);
    setCsvTranslationFailures(0);
    setCsvPreviewError("");
    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
  }

  function acceptCsvJobView(data: Record<string, unknown>, operationId?: string) {
    const view = data as unknown as CsvImportJobView;
    if (!view.job || typeof view.job.id !== "string") {
      throw new Error("CSV Job 返回结果不可识别，请使用原业务 ID 恢复后再继续。");
    }
    if (operationId) csvOperationIds().attachJob(operationId, view.job.id);
    setCsvJobView(view);
    if (view.job.status === "completed" && view.job.failed_rows === 0) {
      clearCompletedCsvForm(operationId || view.job.client_request_id);
    }
    return view;
  }

  async function recoverPendingCsvImport(showToast = false) {
    let pending: ReturnType<CsvImportOperationIdStore["getPending"]>;
    try {
      pending = csvOperationIds().getPending();
    } catch (error) {
      setCsvPreviewError(error instanceof Error ? error.message : "CSV 业务状态无法读取，请先人工核对。 ");
      return;
    }
    if (!pending) return;
    if (!pending.attempted) {
      csvOperationIds().cancel();
      setCsvHasPendingOperation(false);
      return;
    }
    setCsvHasPendingOperation(true);
    setCsvBusy("recover");
    setCsvPreviewError("");
    try {
      const path = pending.jobId
        ? `/api/admin/products/import/jobs/${encodeURIComponent(pending.jobId)}`
        : `/api/admin/products/import?operationId=${encodeURIComponent(pending.operationId)}`;
      const data = await csvFetchJson(path);
      const view = acceptCsvJobView(data, pending.operationId);
      if (showToast) toast(`已恢复 CSV Job：成功 ${view.job.succeeded_rows}，失败 ${view.job.failed_rows}，待处理 ${view.job.pending_rows}`);
    } catch (error) {
      setCsvPreviewError(`${error instanceof Error ? error.message : "CSV Job 恢复失败"} 原业务 ID 已保留；登录失效、权限变化或暂时未找到 Job 都不能证明原请求未写入。`);
      if (showToast) toast(error instanceof Error ? error.message : "CSV Job 恢复失败", "err");
    } finally {
      setCsvBusy(null);
    }
  }

  useEffect(() => {
    if (!adminSession || !adminFeatures.csv_import || !hasPermission("products:write")) return;
    void recoverPendingCsvImport(false);
  }, [adminSession, adminAuthToken, activePassword, adminFeatures.csv_import]);

  function handleProductOperationFailure(scope: string, operationId: string, error: unknown) {
    if (error instanceof AdminApiError && error.operationSafeToDiscard) {
      try { productOperationIds().discardKnownNoWrite(scope, operationId); } catch {}
      return;
    }
    if (error instanceof ProductOperationStateError && error.code !== "OPERATION_STORAGE_UNAVAILABLE") {
      setConfirm({
        open: true,
        title: "重置未确认的商品操作？",
        desc: `${error.message} 只有确认已核对商品、Variant、库存余额和流水后，才应重置并生成新的业务 ID。`,
        confirmText: "我已核对，重置操作",
        variant: "danger",
        action: () => {
          try {
            productOperationIds().cancel(scope);
            toast("未确认的商品业务 ID 已重置，请重新提交。", "ok");
          } catch (resetError) {
            toast(resetError instanceof Error ? resetError.message : "无法重置商品操作状态", "err");
          } finally {
            setConfirm(c => ({ ...c, open: false }));
          }
        },
      });
    }
  }

  function handleInventoryOperationFailure(
    store: InventoryOperationIdStore,
    scope: string,
    operationId: string,
    error: unknown,
  ) {
    if (error instanceof AdminApiError && error.operationSafeToDiscard) {
      try { store.discardKnownNoWrite(scope, operationId); } catch {}
      return;
    }
    if (error instanceof InventoryOperationStateError && error.code !== "OPERATION_STORAGE_UNAVAILABLE") {
      setConfirm({
        open: true,
        title: "重置未确认的库存操作？",
        desc: `${error.message} 只有确认已核对库存流水后，才应重置并生成新的业务 ID。`,
        confirmText: "我已核对，重置操作",
        variant: "danger",
        action: () => {
          try {
            store.cancel(scope);
            toast("未确认的业务 ID 已由你主动重置，请重新提交。", "ok");
          } catch (resetError) {
            toast(resetError instanceof Error ? resetError.message : "无法重置操作状态", "err");
          }
          setConfirm(current => ({ ...current, open: false }));
        },
      });
    }
  }

  function posCheckoutFingerprint() {
    return JSON.stringify({
      paymentMethod: posPaymentMethod,
      discountTotal: posDiscount,
      items: posCart.map(item => ({ variantId: item.variant_id, quantity: item.cartQuantity })),
    });
  }

  function formatEuro(value: number) {
    return `€${Number(value || 0).toFixed(2)}`;
  }

  function addPosItem(item: PosSearchItem) {
    if (item.outOfStock || item.quantity_available <= 0) {
      const message = `${item.variant_sku || item.product_sku} 当前无可用库存`;
      setPosMessage(message);
      toast(message, "err");
      return;
    }
    setPosCart(current => {
      const existing = current.find(cartItem => cartItem.variant_id === item.variant_id);
      if (existing) {
        const nextQty = Math.min(existing.cartQuantity + 1, item.quantity_available);
        if (nextQty === existing.cartQuantity) toast("待扣数量不能超过当前可用库存", "err");
        return current.map(cartItem => cartItem.variant_id === item.variant_id ? { ...cartItem, ...item, cartQuantity: nextQty } : cartItem);
      }
      return [...current, { ...item, cartQuantity: 1 }];
    });
    setPosPreview(null);
    setPosMessage(`${item.variant_sku || item.product_sku} 已加入待扣库存清单`);
    window.setTimeout(() => posSearchInputRef.current?.focus(), 30);
  }

  function moveStockLookupItemToPos(item: InventoryItem) {
    const product = products.find(candidate => Number(candidate.id) === item.product_id);
    addPosItem({
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_sku: item.product_sku,
      variant_sku: item.variant_sku,
      barcode: item.barcode,
      name: item.product_name,
      size: item.size,
      color: item.color,
      price: item.price,
      quantity_on_hand: item.quantity_on_hand,
      quantity_reserved: item.quantity_reserved,
      quantity_available: item.quantity_available,
      product_active: item.active,
      variant_active: item.active,
      image_url: product?.image_url || "",
      outOfStock: item.quantity_available <= 0,
    });
    setPosQuery("");
    setTab("pos");
    window.setTimeout(() => posSearchInputRef.current?.focus(), 80);
  }

  function setPosCartQuantity(variantId: string, quantity: number) {
    setPosCart(current => current.map(item => {
      if (item.variant_id !== variantId) return item;
      const nextQty = Math.max(1, Math.min(Math.trunc(quantity) || 1, item.quantity_available));
      return { ...item, cartQuantity: nextQty };
    }));
    setPosPreview(null);
  }

  function removePosCartItem(variantId: string) {
    setPosCart(current => current.filter(item => item.variant_id !== variantId));
    setPosPreview(null);
  }

  async function searchPosProducts(autoAdd = false) {
    setPosLoading(true);
    setPosMessage("");
    try {
      const params = new URLSearchParams();
      if (posQuery.trim()) params.set("q", posQuery.trim());
      const data = await posApi(`/api/admin/pos/search?${params.toString()}`);
      const items = (Array.isArray(data.items) ? data.items : []) as PosSearchItem[];
      setPosResults(items);
      if (items.length === 0) {
        setPosMessage("没有找到商品，请检查条码、SKU 或商品名。");
        return;
      }
      if (autoAdd) {
        const q = posQuery.trim().toLowerCase();
        const exact = items.find(item =>
          item.barcode?.toLowerCase() === q ||
          item.variant_sku.toLowerCase() === q ||
          item.product_sku.toLowerCase() === q
        );
        if (exact || items.length === 1) {
          addPosItem(exact || items[0]);
          setPosQuery("");
        } else {
          setPosMessage(`找到 ${items.length} 个结果，请选择要加入购物车的商品。`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 搜索失败";
      setPosMessage(message);
      toast(message, "err");
    } finally {
      setPosLoading(false);
    }
  }

  async function runPosDryRun(silent = false) {
    if (posCart.length === 0) {
      const message = "请先把商品加入待扣库存清单。";
      setPosMessage(message);
      if (!silent) toast(message, "err");
      return false;
    }
    if (posDiscount > posSubtotal) {
      const message = "折扣不能大于小计金额。";
      setPosMessage(message);
      if (!silent) toast(message, "err");
      return false;
    }
    setPosCheckoutLoading(true);
    setPosMessage("");
    try {
      const preview = await posApi("/api/admin/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          paymentMethod: posPaymentMethod,
          dryRun: true,
          discountTotal: posDiscount,
          items: posCart.map(item => ({ variantId: item.variant_id, quantity: item.cartQuantity })),
        }),
      });
      setPosPreview(preview);
      setPosMessage("预检通过：库存和金额正常。");
      if (!silent) toast("POS 预检通过");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 预检失败";
      setPosPreview(null);
      setPosMessage(message);
      toast(message, "err");
      return false;
    } finally {
      setPosCheckoutLoading(false);
    }
  }

  async function executePosCheckout() {
    const operationScope = "checkout";
    const operationId = posOperationIds().getOrCreate(operationScope, posCheckoutFingerprint());
    setPosCheckoutLoading(true);
    try {
      const result = (await posApi("/api/admin/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: operationId,
          paymentMethod: posPaymentMethod,
          discountTotal: posDiscount,
          items: posCart.map(item => ({ variantId: item.variant_id, quantity: item.cartQuantity })),
        }),
      })) as PosOrderResult;

      posOperationIds().complete(operationScope, operationId);
      setPosLastOrder(result);
      setPosCart([]);
      setPosPreview(null);
      setPosMessage(result.alreadyProcessed ? "该记录已处理，没有重复扣库存。" : "库存已扣减，并保存了本次线下收款参考记录。");
      toast(result.alreadyProcessed ? "该记录已处理" : "库存已扣减");
      await loadProducts();
      if (inventoryItems.length > 0) await loadInventoryData();
      window.setTimeout(() => posSearchInputRef.current?.focus(), 60);
    } catch (error) {
      posOperationIds().markUncertain(operationScope, operationId);
      const message = error instanceof Error ? error.message : "POS 库存扣减失败";
      setPosMessage(message);
      toast(message, "err");
    } finally {
      setPosCheckoutLoading(false);
    }
  }

  async function confirmPosCheckout() {
    const ok = await runPosDryRun(true);
    if (!ok) return;
    setConfirm({
      open: true,
      title: "确认线下已经收款",
      desc: `本系统不会发起真实支付。请确认已在实体收银机完成收款，再创建参考记录并扣减库存。金额：${formatEuro(posTotal)}，记录方式：${paymentMethodLabel(posPaymentMethod)}。`,
      confirmText: "已收款，确认扣库存",
      variant: "danger",
      action: () => {
        setConfirm(c => ({ ...c, open: false }));
        void executePosCheckout();
      },
    });
  }

  async function loadPosOrders(nextOffset = 0) {
    setPosOrdersLoading(true);
    setPosOrdersMessage("");
    try {
      const params = new URLSearchParams();
      if (posOrderQ.trim()) params.set("q", posOrderQ.trim());
      params.set("status", posOrderStatus);
      params.set("paymentMethod", posOrderPaymentMethod);
      params.set("dateRange", posOrderDateRange);
      params.set("limit", "100");
      params.set("offset", String(Math.max(0, nextOffset)));
      const data = await posApi(`/api/admin/pos/orders?${params.toString()}`);
      const orders = (Array.isArray(data.orders) ? data.orders : []) as PosOrderListItem[];
      setPosOrders(orders);
      setPosOrdersTotal(Number(data.total || 0));
      setPosOrdersOffset(Math.max(0, nextOffset));
      if (orders.length === 0) setPosOrdersMessage("没有找到符合条件的 POS 订单。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 订单读取失败";
      setPosOrdersMessage(message);
      toast(message, "err");
    } finally {
      setPosOrdersLoading(false);
    }
  }

  async function loadPosDailyReport(nextOffset = 0) {
    setPosDailyLoading(true);
    setPosDailyMessage("");
    try {
      const params = new URLSearchParams();
      params.set("date", posDailyDate);
      params.set("limit", "100");
      params.set("offset", String(Math.max(0, nextOffset)));
      const data = await posApi(`/api/admin/pos/reports/daily?${params.toString()}`);
      setPosDailyReport(data as PosDailyReport);
      setPosDailyOffset(Math.max(0, nextOffset));
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 日报读取失败";
      setPosDailyMessage(message);
      toast(message, "err");
    } finally {
      setPosDailyLoading(false);
    }
  }

  async function loadPosOrderDetail(orderId: string) {
    setPosOrderDetailLoading(true);
    try {
      const data = await posApi(`/api/admin/pos/orders/${orderId}`);
      setPosOrderDetail(data as PosOrderDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 订单详情读取失败";
      toast(message, "err");
    } finally {
      setPosOrderDetailLoading(false);
    }
  }

  async function openPosReceipt(orderId: string) {
    if (!initialPrintSettings.business_name.trim() || initialPrintSettings.business_name === "Online Store") {
      toast("请先由维护者在店铺设置中填写真实店名，再打印小票。", "err");
      return;
    }
    setPosReceiptLoading(true);
    try {
      if (posOrderDetail?.order.id === orderId) {
        setPosReceiptDetail(posOrderDetail);
        return;
      }
      const data = await posApi(`/api/admin/pos/orders/${orderId}`);
      setPosReceiptDetail(data as PosOrderDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 小票读取失败";
      toast(message, "err");
    } finally {
      setPosReceiptLoading(false);
    }
  }

  function openPosVoidDialog(order: PosOrderListItem) {
    setPosVoidDialog({ order, reason: "", submitting: false, message: "" });
  }

  function cancelPosVoidDialog() {
    if (posVoidDialog) posOperationIds().cancel(`void:${posVoidDialog.order.id}`);
    setPosVoidDialog(null);
  }

  async function submitPosVoid() {
    if (!posVoidDialog) return;
    const order = posVoidDialog.order;
    const reason = posVoidDialog.reason.trim();
    if (reason.length < 3) {
      setPosVoidDialog(current => current ? { ...current, message: "请填写作废原因，至少 3 个字符。" } : current);
      return;
    }

    const operationScope = `void:${order.id}`;
    const operationId = posOperationIds().getOrCreate(operationScope, order.id);
    setPosVoidDialog(current => current ? { ...current, submitting: true, message: "" } : current);
    try {
      const data = await posApi(`/api/admin/pos/orders/${order.id}/void`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          clientRequestId: operationId,
        }),
      });

      posOperationIds().complete(operationScope, operationId);
      toast(data.alreadyProcessed ? "该订单已作废。" : "订单已作废，库存已加回。", "ok");
      setPosVoidDialog(null);
      await loadPosOrders();
      if (posOrderDetail?.order.id === order.id) {
        await loadPosOrderDetail(order.id);
      }
      void loadInventoryData();
      void loadProducts();
    } catch (error) {
      posOperationIds().markUncertain(operationScope, operationId);
      const message = error instanceof Error ? error.message : "POS 订单作废失败";
      setPosVoidDialog(current => current ? { ...current, submitting: false, message } : current);
      toast(message, "err");
    }
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const rows: AdminProduct[] = [];
      const pageSize = 500;
      let offset = 0;
      while (true) {
        const d = await api(`/api/admin/products?limit=${pageSize}&offset=${offset}`);
        const page = Array.isArray(d.products) ? d.products as AdminProduct[] : [];
        rows.push(...page);
        offset += page.length;
        if (page.length < pageSize || offset >= Number(d.total || 0)) break;
      }
      setProducts(rows);
    } catch (e) {
      toast(e instanceof Error ? e.message : "商品读取失败", "err");
    } finally {
      setLoading(false);
    }
  }
  async function loadSuppliers() { try { const d = await api("/api/admin/suppliers"); setSuppliers(d.suppliers || []); } catch { setSuppliers([]); } }
  useEffect(() => { if (adminSession) { void loadProducts(); void loadSuppliers(); } }, [adminSession, adminAuthToken, activePassword]);

  async function loadInventoryOverview(overrides: Partial<{ category: string; subcategory: string; q: string; size: string }> = {}) {
    const params = new URLSearchParams({ limit: "500" });
    const category = overrides.category ?? inventoryCategory;
    const subcategory = overrides.subcategory ?? inventorySubcategory;
    const query = overrides.q ?? inventoryQ;
    const size = overrides.size ?? inventorySize;
    if (category) params.set("category", category);
    if (subcategory) params.set("subcategory", subcategory);
    if (query.trim()) params.set("q", query.trim());
    if (size.trim()) params.set("size", size.trim());
    const d = await api(`/api/admin/inventory?${params.toString()}`);
    setInventoryItems(d.items || []);
  }
  async function refreshInventoryOverview(overrides: Partial<{ category: string; subcategory: string; q: string; size: string }> = {}) {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      await loadInventoryOverview(overrides);
    } catch (error) {
      const message = error instanceof Error ? error.message : "库存筛选加载失败";
      setInventoryError(message);
      toast(message, "err");
    } finally {
      setInventoryLoading(false);
    }
  }
  async function loadLabelInventoryData() {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      const rows: InventoryItem[] = [];
      const pageSize = 500;
      let offset = 0;
      while (true) {
        const d = await api(`/api/admin/inventory?limit=${pageSize}&offset=${offset}`);
        const page = Array.isArray(d.items) ? d.items as InventoryItem[] : [];
        rows.push(...page);
        offset += page.length;
        if (page.length < pageSize || offset >= Number(d.total || 0)) break;
      }
      setInventoryItems(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "标签商品加载失败";
      setInventoryError(message);
      toast(message, "err");
    } finally {
      setInventoryLoading(false);
    }
  }
  async function loadStockLookup() {
    const query = stockLookupQuery.trim();
    const size = stockLookupSize.trim();
    if (!query && !size) {
      setStockLookupError("请输入商品名、SKU、条码或尺码。");
      setStockLookupMessage("");
      setStockLookupHasSearched(false);
      stockLookupInputRef.current?.focus();
      return;
    }

    setStockLookupLoading(true);
    setStockLookupError("");
    setStockLookupMessage("");
    setStockLookupHasSearched(true);
    try {
      const requestItems = async (nextQuery: string, nextSize: string) => {
        const params = new URLSearchParams({ limit: "200" });
        if (nextQuery) params.set("q", nextQuery);
        if (nextSize) params.set("size", nextSize);
        const data = await api(`/api/admin/inventory?${params.toString()}`);
        return (Array.isArray(data.items) ? data.items : []) as InventoryItem[];
      };

      let items = await requestItems(query, size);
      const normalizedQuery = query.toLowerCase();
      const exact = query ? items.find(item => [item.barcode, item.variant_sku, item.supplier_sku]
        .some(value => value?.trim().toLowerCase() === normalizedQuery)) : undefined;

      if (exact && !size && exact.product_sku.toLowerCase() !== normalizedQuery) {
        const sameProductItems = (await requestItems(exact.product_sku, ""))
          .filter(item => item.product_id === exact.product_id);
        if (sameProductItems.length > 0) {
          items = sameProductItems;
          setStockLookupMessage(`已识别 ${exact.size || "ONE SIZE"}，并展开同款全部尺码。`);
        }
      }

      setStockLookupItems(items);
      if (items.length === 0) {
        setStockLookupMessage("没有找到匹配商品，请检查条码、SKU、商品名或尺码。");
      } else if (!exact || size) {
        const productCount = new Set(items.map(item => item.product_id)).size;
        setStockLookupMessage(`找到 ${productCount} 款商品、${items.length} 个尺码 / Variant。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "库存查询失败";
      setStockLookupItems([]);
      setStockLookupError(message);
    } finally {
      setStockLookupLoading(false);
    }
  }
  function selectStockOperationItem(item: InventoryItem) {
    setStockOperationItem(item);
    setStockOperationQuantity(stockOperationMode === "stocktake" ? "" : "1");
    setStockOperationError("");
    setStockOperationMessage(`已选择 ${item.variant_sku}，请填写数量后确认。`);
    window.setTimeout(() => stockOperationQuantityRef.current?.focus(), 40);
  }
  async function searchStockOperationItem() {
    const query = stockOperationQuery.trim();
    if (!query) {
      setStockOperationError("请扫描条码或输入商品 SKU、供货商 SKU、商品名。");
      stockOperationInputRef.current?.focus();
      return;
    }

    setStockOperationLoading(true);
    setStockOperationError("");
    setStockOperationMessage("");
    setStockOperationItem(null);
    setStockOperationQuantity("");
    try {
      const params = new URLSearchParams({ q: query, limit: "100" });
      const data = await api(`/api/admin/inventory?${params.toString()}`);
      const items = (Array.isArray(data.items) ? data.items : []) as InventoryItem[];
      setStockOperationResults(items);
      const normalizedQuery = query.toLowerCase();
      const exact = items.find(item => [item.barcode, item.variant_sku, item.supplier_sku]
        .some(value => value?.trim().toLowerCase() === normalizedQuery));
      const selected = exact || (items.length === 1 ? items[0] : null);

      if (selected) {
        selectStockOperationItem(selected);
      } else if (items.length === 0) {
        setStockOperationError("未找到匹配的库存记录，请检查条码或 SKU。");
      } else {
        setStockOperationMessage(`找到 ${items.length} 个 Variant，请选择正确尺码。`);
      }
    } catch (error) {
      setStockOperationResults([]);
      setStockOperationError(error instanceof Error ? error.message : "库存商品查询失败");
    } finally {
      setStockOperationLoading(false);
    }
  }
  async function ensureStockOperationBarcode(item: InventoryItem) {
    const plan = getStockOperationBarcodePlan({
      mode: stockOperationMode,
      barcode: item.barcode,
      barcodeFeatureEnabled: adminFeatures.barcode_labels,
    });
    if (plan.action === "keep") return { item, generated: false };
    if (plan.action === "unavailable") {
      throw new Error("当前版本未启用条码与标签打印，无法为无条码商品执行到货扫码。请先启用该功能，或选择已有 Barcode 的规格。");
    }

    const operationScope = `stock-receiving-barcode:${item.variant_id}`;
    const fingerprint = createProductOperationFingerprint({
      variantIds: [item.variant_id],
      mode: "variant_sku",
    });
    let operationId = "";
    let completed = false;
    setStockOperationMessage(`正在为 ${item.variant_sku} 生成内部 Barcode，再继续入库...`);
    try {
      operationId = productOperationIds().getOrCreate(operationScope, fingerprint);
      productOperationIds().markAttempt(operationScope, operationId);
      const result = await api("/api/admin/variants/generate-barcodes", {
        method: "POST",
        body: JSON.stringify({
          variantIds: [item.variant_id],
          mode: "variant_sku",
          clientRequestId: operationId,
        }),
      });
      productOperationIds().complete(operationScope, operationId);
      completed = true;

      const resultItems = Array.isArray(result.items) ? result.items as Array<Record<string, unknown>> : [];
      const variantResult = resultItems.find(candidate => candidate.variantId === item.variant_id);
      if (variantResult?.status === "failed" || Number(result.failed || 0) > 0) {
        throw new Error(typeof variantResult?.message === "string" ? variantResult.message : "内部 Barcode 生成失败，库存尚未入库。");
      }

      const barcode = typeof variantResult?.barcode === "string" && variantResult.barcode.trim()
        ? variantResult.barcode.trim()
        : item.variant_sku.trim();
      const updatedItem = { ...item, barcode };
      const updateBarcode = (candidate: InventoryItem) => candidate.variant_id === item.variant_id
        ? { ...candidate, barcode }
        : candidate;
      setStockOperationItem(updatedItem);
      setStockOperationResults(current => current.map(updateBarcode));
      setStockLookupItems(current => current.map(updateBarcode));
      setInventoryItems(current => current.map(updateBarcode));
      return { item: updatedItem, generated: Number(result.generated || 0) > 0 };
    } catch (error) {
      if (operationId && !completed) handleProductOperationFailure(operationScope, operationId, error);
      throw error;
    }
  }
  async function executeStockOperation() {
    const selectedItem = stockOperationItem;
    if (!selectedItem) return;
    const quantity = Number(stockOperationQuantity);
    const option = stockOperationOptions.find(candidate => candidate.key === stockOperationMode)!;
    const reference = stockOperationReference.trim();
    const reason = reference ? `${option.reason}；备注/单据号：${reference}` : option.reason;

    const mode = stockOperationMode === "stocktake" ? "set_to" : "adjust_by";
    const operationScope = `stock-operation:${selectedItem.variant_id}:${stockOperationMode}`;
    const fingerprint = JSON.stringify({ variantId: selectedItem.variant_id, mode, quantity, reason, operationType: stockOperationMode });
    let operationId = "";

    setStockOperationSubmitting(true);
    setStockOperationError("");
    try {
      const barcodeResult = await ensureStockOperationBarcode(selectedItem);
      const item = barcodeResult.item;
      operationId = inventoryOperationIds().getOrCreate(operationScope, fingerprint);
      inventoryOperationIds().markAttempt(operationScope, operationId);
      const result = await api("/api/admin/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          variantId: item.variant_id,
          mode,
          quantity,
          reason,
          operationType: stockOperationMode,
          clientRequestId: operationId,
        }),
      });
      try { inventoryOperationIds().complete(operationScope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "操作成功，但本地业务 ID 清理失败。", "err");
      }
      const before = Number(result.quantityBefore ?? item.quantity_on_hand);
      const after = Number(result.quantityAfter ?? before);
      const actionMessage = result.noChange
        ? `${option.label}完成：库存没有变化（${before} → ${after}）。`
        : `${option.label}完成：${item.variant_sku} 库存 ${before} → ${after}。`;
      const barcodeMessage = barcodeResult.generated ? `已生成内部 Barcode ${item.barcode}；` : "";
      const warning = result.legacySyncWarning ? ` 旧库存同步需要检查：${result.legacySyncWarning}` : "";
      setStockOperationMessage(`${barcodeMessage}${actionMessage}${warning}`);
      toast(`${barcodeMessage}${actionMessage}${warning}`, result.legacySyncWarning ? "err" : "ok");

      const updateQuantity = (candidate: InventoryItem) => {
        if (candidate.variant_id !== item.variant_id) return candidate;
        const nextReserved = Math.min(candidate.quantity_reserved, after);
        return {
          ...candidate,
          quantity_on_hand: after,
          quantity_reserved: nextReserved,
          quantity_available: after - nextReserved,
        };
      };
      setStockLookupItems(current => current.map(updateQuantity));
      setInventoryItems(current => current.map(updateQuantity));
      setStockOperationQuery("");
      setStockOperationResults([]);
      setStockOperationItem(null);
      setStockOperationQuantity("");
      setStockOperationReference("");
      await loadProducts();
      window.setTimeout(() => stockOperationInputRef.current?.focus(), 60);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${option.label}失败`;
      if (operationId) handleInventoryOperationFailure(inventoryOperationIds(), operationScope, operationId, error);
      setStockOperationError(message);
      toast(message, "err");
    } finally {
      setStockOperationSubmitting(false);
    }
  }
  function submitStockOperation() {
    const item = stockOperationItem;
    if (!item) {
      setStockOperationError("请先扫描并选择一个具体尺码 / Variant。");
      stockOperationInputRef.current?.focus();
      return;
    }
    const quantity = Number(stockOperationQuantity);
    const option = stockOperationOptions.find(candidate => candidate.key === stockOperationMode)!;
    if (!Number.isInteger(quantity)) {
      setStockOperationError("数量必须是整数。");
      stockOperationQuantityRef.current?.focus();
      return;
    }
    if (stockOperationMode === "stocktake" ? quantity < 0 : quantity <= 0) {
      setStockOperationError(stockOperationMode === "stocktake" ? "实际清点数量不能小于 0。" : "增加数量必须大于 0。");
      stockOperationQuantityRef.current?.focus();
      return;
    }
    const nextQuantity = stockOperationMode === "stocktake" ? quantity : item.quantity_on_hand + quantity;
    const reference = stockOperationReference.trim();
    const barcodePlan = getStockOperationBarcodePlan({
      mode: stockOperationMode,
      barcode: item.barcode,
      barcodeFeatureEnabled: adminFeatures.barcode_labels,
    });
    if (barcodePlan.action === "unavailable") {
      setStockOperationError("当前版本未启用条码与标签打印，不能为无条码商品自动生成 Barcode。请先启用该功能，或选择已有 Barcode 的规格。");
      return;
    }
    const barcodeNotice = barcodePlan.action === "generate"
      ? `该规格目前没有 Barcode，将先生成内部 Barcode ${item.variant_sku}；生成成功后才会入库。`
      : "";
    setConfirm({
      open: true,
      title: `确认${option.label}`,
      desc: `${item.product_name || item.product_sku} / ${item.variant_sku}，库存将从 ${item.quantity_on_hand} 变为 ${nextQuantity}${reference ? `。备注/单据号：${reference}` : ""}。${barcodeNotice}`,
      confirmText: `确认${option.label}`,
      variant: "default",
      action: () => {
        setConfirm(current => ({ ...current, open: false }));
        void executeStockOperation();
      },
    });
  }
  async function loadInventoryMovements(nextVariantId = movementVariantId) {
    const params = new URLSearchParams();
    params.set("limit", String(movementLimit));
    if (movementQ.trim()) params.set("q", movementQ.trim());
    if (movementType) params.set("movementType", movementType);
    if (movementSourceType) params.set("sourceType", movementSourceType);
    if (nextVariantId) params.set("variantId", nextVariantId);
    const d = await api(`/api/admin/inventory/movements?${params.toString()}`);
    setInventoryMovements(d.items || []);
  }
  async function loadInventoryReconciliation() {
    const d = await api("/api/admin/inventory/reconciliation");
    setInventoryReconciliation(d);
  }
  async function loadInventoryData(nextVariantId = movementVariantId) {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      await Promise.all([loadInventoryOverview(), loadInventoryMovements(nextVariantId), loadInventoryReconciliation()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "库存数据加载失败";
      setInventoryError(message);
      toast(message, "err");
    } finally {
      setInventoryLoading(false);
    }
  }
  useEffect(() => {
    if (!adminSession) return;
    if (tab === "inventory") void loadInventoryData();
    if (tab === "labels") void loadLabelInventoryData();
  }, [adminSession, adminAuthToken, activePassword, tab]);
  useEffect(() => {
    if (!adminSession || tab !== "stockLookup") return;
    window.setTimeout(() => stockLookupInputRef.current?.focus(), 50);
  }, [adminSession, tab]);
  useEffect(() => {
    if (!adminSession || tab !== "stockOperations") return;
    window.setTimeout(() => stockOperationInputRef.current?.focus(), 50);
  }, [adminSession, tab]);
  function toggleLabelVariant(variantId: string) {
    setSelectedLabelVariantIds(prev => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }
  function updateLabelSelection(items: InventoryItem[], selected: boolean) {
    setSelectedLabelVariantIds(prev => {
      const next = new Set(prev);
      for (const item of items) {
        if (selected) next.add(item.variant_id);
        else next.delete(item.variant_id);
      }
      return next;
    });
  }
  function selectAllVisibleLabelVariants() {
    setSelectedLabelVariantIds(current => addVisibleVariantsToSelection(current, visibleLabelItems));
    setLabelMessage(`已将当前筛选结果的 ${visibleLabelItems.length} 个规格加入选择。`);
  }
  function selectOnlyVisibleMissingBarcodes() {
    const missingItems = visibleLabelItems.filter(item => !barcodeIsPresent(item.barcode));
    if (missingItems.length === 0) {
      setLabelMessage("当前筛选结果没有缺少 Barcode 的规格。");
      toast("当前筛选结果没有缺少 Barcode 的规格。", "err");
      return;
    }
    setSelectedLabelVariantIds(current => selectVisibleMissingBarcodes(current, visibleLabelItems));
    setLabelMessage(`已将当前筛选结果中缺少 Barcode 的 ${missingItems.length} 个规格加入选择。`);
  }
  function cancelLabelSelection() {
    const cleared = clearBarcodeLabelQueue();
    setSelectedLabelVariantIds(cleared.selectedVariantIds);
    setLabelCopyCounts(cleared.copyCounts);
    setLabelPreviewItems(cleared.previewItems);
    try {
      productOperationIds().cancel("barcode-generate");
    } catch (error) {
      toast(error instanceof Error ? error.message : "无法清除 Barcode 操作状态", "err");
    }
    setLabelMessage("已取消全部选择，并清空待打印队列和打印数量。");
  }
  function chooseLabelProduct(productId: string) {
    setLabelProductId(productId);
    setLabelSizeFilter("");
    setLabelMessage("");
    if (productId) window.setTimeout(() => labelVariantPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  function locateLabelProduct() {
    const query = labelSearch.trim().toLowerCase();
    if (!query) {
      setLabelMessage("请输入商品名、SKU、条码或供货商 SKU，或者直接从商品选择器中选择。");
      return;
    }

    const exactVariant = inventoryItems.find(item => [item.variant_sku, item.barcode, item.supplier_sku]
      .some(value => String(value || "").trim().toLowerCase() === query));
    if (exactVariant) {
      setLabelCategory("");
      setLabelSubcategory("");
      setLabelProductId(String(exactVariant.product_id));
      setLabelSizeFilter(exactVariant.size || "ONE SIZE");
      setLabelMessage(`已定位 ${exactVariant.product_name || exactVariant.product_sku} · ${exactVariant.size || "ONE SIZE"}`);
      window.setTimeout(() => labelVariantPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }

    const exactProduct = labelProductGroups.find(group => [group.productSku, group.productName]
      .some(value => value.trim().toLowerCase() === query));
    if (exactProduct) {
      setLabelCategory("");
      setLabelSubcategory("");
      chooseLabelProduct(String(exactProduct.productId));
      return;
    }

    if (labelProductOptions.length === 1) {
      chooseLabelProduct(String(labelProductOptions[0].productId));
      return;
    }
    if (labelProductOptions.length === 0) {
      setLabelMessage("没有找到匹配的商品，请检查名称、SKU 或条码。");
      return;
    }
    setLabelMessage(`找到 ${labelProductOptions.length} 件匹配商品，请在下方商品列表中选择。`);
  }
  function labelFromInventoryItem(item: InventoryItem): PrintableVariantLabel {
    return {
      product_name: item.product_name,
      product_name_en: item.product_name_en,
      product_name_gr: item.product_name_gr,
      product_sku: item.product_sku,
      variant_id: item.variant_id,
      variant_sku: item.variant_sku,
      barcode: item.barcode,
      size: item.size,
      color: item.color,
      price: item.price,
      quantity_on_hand: item.quantity_on_hand,
      active: item.active,
      supplier_sku: item.supplier_sku,
    };
  }
  function confirmGenerateSelectedBarcodes() {
    if (selectedLabelItems.length === 0) {
      toast("请先选择需要补全 Barcode 的规格", "err");
      return;
    }
    if (selectedMissingBarcodeItems.length === 0) {
      const message = "已选规格全部已有 Barcode，不会发送生成请求。";
      setLabelMessage(message);
      toast(message, "err");
      return;
    }
    if (selectedMissingBarcodeItems.length > MAX_BULK_BARCODE_VARIANTS) {
      const message = `单次最多补全 ${MAX_BULK_BARCODE_VARIANTS} 个规格，请先缩小筛选范围或减少选择。`;
      setLabelMessage(message);
      toast(message, "err");
      return;
    }
    const variantIds = selectedMissingBarcodeItems.map(item => item.variant_id).sort();
    setConfirm({
      open: true,
      title: "确认补全缺失 Barcode？",
      desc: (
        <div className="space-y-2">
          <p>已选择 {labelSelectionSummary.selectedProductCount} 件商品，共 {labelSelectionSummary.selectedVariantCount} 个规格。</p>
          <p>{labelSelectionSummary.selectedMissingBarcodeCount} 个规格缺少 Barcode，将按 Variant SKU 补全。</p>
          <p>{labelSelectionSummary.selectedExistingBarcodeCount} 个已有 Barcode 的规格将被跳过，不会覆盖。</p>
        </div>
      ),
      confirmText: "确认补全",
      variant: "default",
      action: () => {
        setConfirm(current => ({ ...current, open: false }));
        void generateSelectedBarcodes(variantIds);
      },
    });
  }
  async function generateSelectedBarcodes(variantIds: string[]) {
    if (variantIds.length === 0) {
      toast("没有缺少 Barcode 的已选规格", "err");
      return;
    }
    const operationScope = "barcode-generate";
    const fingerprint = createProductOperationFingerprint({
      variantIds: [...variantIds].sort(),
      mode: "variant_sku",
    });
    let operationId = "";
    setLabelGenerating(true);
    setLabelMessage("");
    try {
      operationId = productOperationIds().getOrCreate(operationScope, fingerprint);
      productOperationIds().markAttempt(operationScope, operationId);
      const result = await api("/api/admin/variants/generate-barcodes", {
        method: "POST",
        body: JSON.stringify({
          variantIds,
          mode: "variant_sku",
          clientRequestId: operationId,
        }),
      });
      productOperationIds().complete(operationScope, operationId);
      const failed = Number(result.failed || 0);
      const message = `已补全 ${Number(result.generated || 0)} 个，跳过已有 Barcode ${Number(result.skippedExisting || 0)} 个，失败 ${failed} 个。`;
      setLabelMessage(message);
      toast(message, failed > 0 ? "err" : "ok");
      await loadLabelInventoryData();
    } catch (error) {
      if (operationId) handleProductOperationFailure(operationScope, operationId, error);
      const message = error instanceof Error ? error.message : "补全 Barcode 失败";
      setLabelMessage(message);
      toast(message, "err");
    } finally {
      setLabelGenerating(false);
    }
  }
  function openLabelPreview() {
    if (!initialPrintSettings.business_name.trim() || initialPrintSettings.business_name === "Online Store") {
      toast("请先由维护者在店铺设置中填写真实店名，再打印标签。", "err");
      return;
    }
    const labels = selectedLabelItems
      .filter(item => item.barcode || item.variant_sku)
      .flatMap((item) => {
        const copies = normalizeLabelCopies(labelCopyCounts[item.variant_id], item.quantity_on_hand);
        return Array.from({ length: copies }, (_, index) => ({
          ...labelFromInventoryItem(item),
          print_key: `${item.variant_id}:${index + 1}`,
        }));
      });
    if (labels.length === 0) {
      toast("请先选择已有条码或 variant SKU 的标签", "err");
      return;
    }
    setLabelPreviewItems(labels);
  }
  useEffect(() => {
    if (tab === "pos") {
      window.setTimeout(() => posSearchInputRef.current?.focus(), 50);
    }
  }, [tab]);
  useEffect(() => {
    if (adminSession && tab === "posOrders") {
      void loadPosOrders();
    }
  }, [adminSession, adminAuthToken, activePassword, tab, posOrderStatus, posOrderPaymentMethod, posOrderDateRange]);
  useEffect(() => {
    if (adminSession && tab === "posDaily") {
      void loadPosDailyReport();
    }
  }, [adminSession, adminAuthToken, activePassword, tab, posDailyDate]);
  function openInventoryAdjust(item: InventoryItem) {
    setAdjustInventory({ item, mode: "set_to", quantity: String(item.quantity_on_hand), reason: "", submitting: false, message: "" });
  }
  function closeInventoryAdjustment() {
    const item = adjustInventory.item;
    if (item) {
      try { inventoryOperationIds().cancel(`inventory-adjust:${item.variant_id}`); } catch (error) {
        toast(error instanceof Error ? error.message : "无法清除库存操作状态", "err");
        return;
      }
    }
    setAdjustInventory({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" });
  }
  async function executeInventoryAdjustment() {
    const item = adjustInventory.item;
    if (!item) return;
    const quantity = Number(adjustInventory.quantity);
    const reason = adjustInventory.reason.trim();
    const operationScope = `inventory-adjust:${item.variant_id}`;
    const fingerprint = JSON.stringify({ variantId: item.variant_id, mode: adjustInventory.mode, quantity, reason, operationType: "manual" });
    let operationId = "";
    setAdjustInventory(prev => ({ ...prev, submitting: true, message: "" }));
    try {
      operationId = inventoryOperationIds().getOrCreate(operationScope, fingerprint);
      inventoryOperationIds().markAttempt(operationScope, operationId);
      const result = await api("/api/admin/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          variantId: item.variant_id,
          mode: adjustInventory.mode,
          quantity,
          reason,
          clientRequestId: operationId,
        }),
      });
      try { inventoryOperationIds().complete(operationScope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "操作成功，但本地业务 ID 清理失败。", "err");
      }
      const before = Number(result.quantityBefore ?? item.quantity_on_hand);
      const after = Number(result.quantityAfter ?? before);
      const note = result.alreadyProcessed
        ? `这次调整已经处理过，没有重复写入。库存 ${before} → ${after}。`
        : result.noChange
          ? `库存没有变化（${before} → ${after}）。原因：${reason}`
          : `库存调整成功：${before} → ${after}。原因：${reason}`;
      const warning = result.legacySyncWarning ? ` 但旧库存同步需要检查：${result.legacySyncWarning}` : "";
      toast(`${note}${warning}`, result.legacySyncWarning ? "err" : "ok");
      setAdjustInventory({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" });
      await loadInventoryData(item.variant_id);
      await loadProducts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "库存调整失败";
      if (operationId) handleInventoryOperationFailure(inventoryOperationIds(), operationScope, operationId, error);
      setAdjustInventory(prev => ({ ...prev, submitting: false, message }));
      toast(message, "err");
    }
  }
  function submitInventoryAdjustment() {
    const item = adjustInventory.item;
    if (!item) return;
    const quantity = Number(adjustInventory.quantity);
    const reason = adjustInventory.reason.trim();
    if (!Number.isInteger(quantity)) { setAdjustInventory(prev => ({ ...prev, message: "数量必须是整数" })); return; }
    if (reason.length < 3) { setAdjustInventory(prev => ({ ...prev, message: "请填写至少 3 个字的调整原因" })); return; }
    const nextQuantity = adjustInventory.mode === "set_to" ? quantity : item.quantity_on_hand + quantity;
    if (nextQuantity < 0) { setAdjustInventory(prev => ({ ...prev, message: "调整后库存不能小于 0" })); return; }
    setConfirm({
      open: true,
      title: "确认调整库存",
      desc: `${item.variant_sku} 当前库存 ${item.quantity_on_hand}，调整后 ${nextQuantity}。原因：${reason}`,
      confirmText: "确认调整",
      variant: "default",
      action: () => {
        setConfirm(c => ({ ...c, open: false }));
        void executeInventoryAdjustment();
      },
    });
  }

  function parseSizeStockText(value: string) {
    const out: Record<string, number> = {};
    value.split(/[,，\n]+/).map(part => part.trim()).filter(Boolean).forEach(part => {
      const [rawSize, rawQty] = part.split(/[:：=]/).map(x => x?.trim());
      const qty = Number(rawQty);
      if (rawSize && Number.isFinite(qty) && qty >= 0) out[rawSize.toUpperCase()] = Math.floor(qty);
    });
    return out;
  }
  function quickSku(cat = quickAdd.category, sub = quickAdd.subcategory) {
    const prefix = skuPrefix(cat, sub);
    let max = 0;
    for (const product of products) {
      if (!product.sku.startsWith(prefix)) continue;
      const n = parseInt(product.sku.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }
  function syncVariantMatrix(rows: ProductVariantMatrixRow[]) {
    setVariantMatrix(rows);
    setSizeStock(matrixSizeStock(rows));
    setVariantProcurement(Object.fromEntries(rows.map(row => [
      variantProcurementKey(row.size, row.color),
      {
        supplier_sku: row.supplierSku || "",
        cost_price: row.costPrice ?? null,
        reorder_level: row.reorderLevel ?? null,
      },
    ])));
  }
  function syncQuickVariantMatrix(rows: ProductVariantMatrixRow[]) {
    setQuickVariantMatrix(rows);
    setQuickSizeStock(matrixSizeStock(rows));
  }
  function updateQuickAdd<K extends keyof QuickAddState>(key: K, value: QuickAddState[K]) {
    if (key === "category") {
      const nextCategory = value as ProductCategory;
      const nextSizeSystem = inferredSizeSystem(nextCategory);
      const total = matrixTotal(quickVariantMatrix) || Number(quickAdd.stock) || 1;
      if (!(sizeKindForCategory(nextCategory) === sizeKindForCategory(quickAdd.category) && quickAdd.size_system === nextSizeSystem)) {
        syncQuickVariantMatrix(sizeKindForCategory(nextCategory) === "one"
          ? [{ size: oneSizeOptions[0], color: quickAdd.color, quantity: Math.max(0, Math.trunc(total)) }]
          : []);
      }
      const nextSubcategory = String(adminSubcategoryOptions(nextCategory)[0]?.slug || "");
      setQuickAdd(current => ({ ...current, category: nextCategory, subcategory: nextSubcategory, size_system: nextSizeSystem }));
      return;
    }
    if (key === "size_system") {
      const nextSizeSystem = value as SizeSystem;
      const total = matrixTotal(quickVariantMatrix) || Number(quickAdd.stock) || 1;
      syncQuickVariantMatrix(nextSizeSystem === "one_size"
        ? [{ size: oneSizeOptions[0], color: quickAdd.color, quantity: Math.max(0, Math.trunc(total)) }]
        : []);
      setQuickAdd(current => ({ ...current, size_system: nextSizeSystem }));
      return;
    }
    if (key === "color" && matrixColors(quickVariantMatrix).length <= 1) {
      const nextColor = normalizeVariantColor(value);
      syncQuickVariantMatrix(quickVariantMatrix.map(row => ({ ...row, color: nextColor })));
    }
    setQuickAdd(current => ({ ...current, [key]: value }));
  }
  async function generateQuickProductCopy() {
    const sourceImages = [quickMainFile, ...quickBackFiles].filter((file): file is File => Boolean(file)).slice(0, maxProductVisionImages);
    if (sourceImages.length === 0 && !quickAdd.category && !quickAdd.subcategory && !quickAdd.name_cn.trim() && !quickAdd.description_cn.trim() && !quickAdd.notes.trim()) { toast("请先上传商品照片，或填写分类、商品名或备注。", "err"); return; }
    setAiQuickCopyLoading(true);
    try {
      const sizes = quickVariantMatrix.length > 0 ? sortSizeKeys(matrixSizes(quickVariantMatrix)).join(",") : quickAdd.sizes;
      const colors = matrixColors(quickVariantMatrix).filter(Boolean);
      const d = await generateProductCopyRequest({
        name_cn: quickAdd.name_cn,
        description_cn: quickAdd.description_cn,
        category: quickAdd.category,
        subcategory: quickAdd.subcategory,
        color: colors.join(" / ") || quickAdd.color,
        brand: quickAdd.brand,
        material: quickAdd.material,
        sizes,
        notes: quickAdd.notes,
      }, sourceImages);
      setQuickAdd(current => ({
        ...current,
        name_cn: d.name_cn || current.name_cn,
        description_cn: d.description_cn || current.description_cn,
        name_gr: d.name_gr || current.name_gr,
        description_gr: d.description_gr || current.description_gr,
        name_en: d.name_en || current.name_en,
        description_en: d.description_en || current.description_en,
        material: d.material || current.material,
        fit_type: d.fit_type || current.fit_type,
        ai_keywords: d.ai_keywords || current.ai_keywords,
        style_tags: d.style_tags || current.style_tags,
      }));
      toast(d.images_analyzed
        ? `已读取 ${d.images_analyzed} 张商品照片并生成资料，保存前请检查。`
        : "商品资料已根据现有文字生成，保存前请检查。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI 文案生成失败", "err");
    } finally {
      setAiQuickCopyLoading(false);
    }
  }

  function skuPrefix(cat: string, sub: string) { return `${cat || "x"}-${sub || "x"}-`; }
  function updateField<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    if (key === "category") {
      const nextCat = value as ProductCategory;
      if (sizeKindForCategory(nextCat) !== sizeKindForCategory(form.category)) {
        const total = matrixTotal(variantMatrix) || Number(form.stock) || 1;
        syncVariantMatrix(sizeKindForCategory(nextCat) === "one"
          ? [{ size: oneSizeOptions[0], color: form.color, quantity: Math.max(0, Math.trunc(total)) }]
          : []);
      }
    }
    if (key === "color" && matrixColors(variantMatrix).length <= 1) {
      const nextColor = normalizeVariantColor(value);
      syncVariantMatrix(variantMatrix.map(row => ({ ...row, color: nextColor })));
    }
    setForm(c => {
      if (key === "category") {
        const nextCat = value as ProductCategory;
        const nextSub = String(adminSubcategoryOptions(nextCat)[0]?.slug || "");
        const prefix = skuPrefix(nextCat, nextSub);
        const oldPrefix = skuPrefix(c.category, c.subcategory);
        const skuEmpty = !c.sku.trim() || c.sku === oldPrefix || c.sku.trim() === oldPrefix.replace(/-$/, "");
        const nextSizeSystem = !c.size_system || c.size_system === inferredSizeSystem(c.category)
          ? inferredSizeSystem(nextCat)
          : c.size_system;
        return { ...c, category: nextCat, subcategory: nextSub, size_system: nextSizeSystem, sku: skuEmpty ? prefix : c.sku };
      }
      if (key === "subcategory") {
        const prefix = skuPrefix(c.category, value as string);
        const oldPrefix = skuPrefix(c.category, c.subcategory);
        const skuEmpty = !c.sku.trim() || c.sku === oldPrefix || c.sku.trim() === oldPrefix.replace(/-$/, "");
        return { ...c, subcategory: value as string, sku: skuEmpty ? prefix : c.sku };
      }
      return { ...c, [key]: value };
    });
  }
  function generateNextSku() { const prefix = skuPrefix(form.category, form.subcategory); const existing = products.filter(p => p.sku.startsWith(prefix)); let max = 0; for (const p of existing) { const rest = p.sku.slice(prefix.length); const n = parseInt(rest, 10); if (!isNaN(n) && n > max) max = n; } const next = String(max + 1).padStart(3, "0"); updateField("sku", prefix + next); toast(`SKU 已生成: ${prefix + next}`); }
  function loadSizeStock(p: AdminProduct) {
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      syncVariantMatrix(matrixRowsFromVariants(p.variants));
      return;
    }

    const legacy = (p as Record<string, unknown>).size_stock;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      const fallback: Record<string, number> = {};
      for (const [size, quantity] of Object.entries(legacy as Record<string, unknown>)) {
        if (typeof quantity === "number") fallback[size.toUpperCase()] = quantity;
      }
      syncVariantMatrix(Object.entries(fallback).map(([size, quantity]) => ({
        size,
        color: p.color || "",
        quantity,
        expectedOnHand: quantity,
      })));
      return;
    }
    syncVariantMatrix((p.size_system || inferredSizeSystem(p.category)) === "one_size"
      ? [{ size: oneSizeOptions[0], color: p.color || "", quantity: Math.max(0, Math.trunc(Number(p.stock) || 0)), expectedOnHand: Math.max(0, Math.trunc(Number(p.stock) || 0)) }]
      : []);
  }
  function formFromProduct(p: AdminProduct): ProductFormData { return { sku:p.sku, name_cn:p.name_cn, name_gr:p.name_gr, name_en:p.name_en, description_cn:p.description_cn, description_gr:p.description_gr, description_en:p.description_en, category:p.category, subcategory:p.subcategory, price:p.price, stock:p.stock, sizes:p.sizes, size_system:p.size_system || inferredSizeSystem(p.category), image_url:p.image_url, image_urls:p.image_urls, brand:p.brand, supplier_id:p.supplier_id || "", supplier_style_code:p.supplier_style_code || "", barcode:p.barcode, ean:p.ean || "", mpn:p.mpn || "", vat:FIXED_PRODUCT_VAT_RATE, color:p.color, skroutz_url:p.skroutz_url, is_active:p.is_active, material: p.material || "", fiber_composition_gr:p.fiber_composition_gr || "", fiber_composition_en:p.fiber_composition_en || "", care_instructions_gr:p.care_instructions_gr || "", care_instructions_en:p.care_instructions_en || "", country_of_origin:p.country_of_origin || "", manufacturer_name:p.manufacturer_name || "", manufacturer_contact:p.manufacturer_contact || "", eu_responsible_person:p.eu_responsible_person || "", product_safety_notes_gr:p.product_safety_notes_gr || "", product_safety_notes_en:p.product_safety_notes_en || "", fit_type: (p as Record<string,unknown>).fit_type as string || "regular", ai_keywords: Array.isArray((p as Record<string,unknown>).ai_keywords) ? ((p as Record<string,unknown>).ai_keywords as string[]).join(",") : String((p as Record<string,unknown>).ai_keywords || ""), style_tags: Array.isArray((p as Record<string,unknown>).style_tags) ? ((p as Record<string,unknown>).style_tags as string[]).join(",") : String((p as Record<string,unknown>).style_tags || ""), size_chart: typeof (p as Record<string,unknown>).size_chart === "object" ? JSON.stringify((p as Record<string,unknown>).size_chart) : String((p as Record<string,unknown>).size_chart || ""), material_verified: (p as Record<string,unknown>).material_verified === true }; }
  function openProductForm(p: AdminProduct) { const nextForm = formFromProduct(p); setEditingId(p.id); setEditingProductSnapshot(p); setForm(nextForm); loadSizeStock(p); setShowSizeChart(!!nextForm.size_chart.trim()); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); return nextForm; }
  function startEdit(p: AdminProduct) { openProductForm(p); }
  function focusAdminField(field: string) {
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-admin-field="${field}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus();
    }, 150);
  }
  function handleIssueAction(product: AdminProduct, issueCode: string) {
    if (issueCode === "image" || issueCode === "image-quality") {
      setSelectedImageSku(product.sku);
      setSearch(product.sku);
      setFilterStatus("all");
      setTab("images");
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
      toast("已跳到图片上传区，请重新上传主图。");
      return;
    }
    const fieldMap: Record<string, string> = {
      sku: "sku",
      test: "sku",
      inactive: "is_active",
      price: "price",
      stock: "stock",
      name: "name_cn",
      description: "description_cn",
      "name-gr": "name_gr",
      "name-en": "name_en",
      category: "category",
      subcategory: "subcategory",
      sizes: "sizes",
    };
    openProductForm(product);
    focusAdminField(fieldMap[issueCode] || "sku");
  }
  function copyProduct(p: AdminProduct) { setEditingId(null); setEditingProductSnapshot(null); setForm({ ...p, sku: p.sku + "-COPY" }); const copiedRows = matrixRowsFromVariants(p.variants || []).map(row => ({ ...row, id: undefined, variantSku: undefined, barcode: undefined, expectedOnHand: 0, quantityReserved: 0 })); syncVariantMatrix(copiedRows.length > 0 ? copiedRows : []); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function buildProductVariantPayloads(productBasePriceChanged = false) {
    const originalVariants = editingProductSnapshot?.variants || [];
    const colors = matrixColors(variantMatrix);
    const sizes = sortSizeKeys(matrixSizes(variantMatrix));
    const orderedRows = [...variantMatrix].sort((left, right) => {
      const colorOrder = colors.findIndex(color => color.toLocaleLowerCase() === normalizeVariantColor(left.color).toLocaleLowerCase())
        - colors.findIndex(color => color.toLocaleLowerCase() === normalizeVariantColor(right.color).toLocaleLowerCase());
      if (colorOrder !== 0) return colorOrder;
      return sizes.indexOf(normalizeVariantSize(left.size)) - sizes.indexOf(normalizeVariantSize(right.size));
    });
    return orderedRows.map((row, index) => {
      const normalizedSize = normalizeVariantSize(row.size);
      const normalizedColor = normalizeVariantColor(row.color);
      const original = originalVariants.find(variant =>
        (row.id && variant.id === row.id)
        || variantCatalogKey(variant.size, variant.color) === variantCatalogKey(normalizedSize, normalizedColor),
      );
      const procurement = variantProcurement[variantProcurementKey(normalizedSize, normalizedColor)]
        || variantProcurement[normalizedSize];
      const variantSku = original?.variant_sku || row.variantSku || buildVariantSku(form.sku, normalizedSize, normalizedColor);
      return {
        ...(original?.id ? { id: original.id } : {}),
        variant_sku: variantSku,
        barcode: original?.barcode || row.barcode || variantSku,
        size: normalizedSize,
        color: normalizedColor,
        quantity: Math.max(0, Math.trunc(Number(row.quantity) || 0)),
        ...(original ? { expected_on_hand: Math.max(0, Math.trunc(Number(original.quantity_on_hand) || 0)) } : {}),
        price: original
          ? (productBasePriceChanged
              && (original.price === null
                || original.price === undefined
                || Number(original.price) === Number(editingProductSnapshot?.price))
            ? Number(form.price)
            : original.price ?? null)
          : Number(form.price),
        supplier_id: row.supplierId || form.supplier_id || null,
        supplier_sku: row.supplierSku?.trim() || procurement?.supplier_sku?.trim() || "",
        cost_price: row.costPrice ?? procurement?.cost_price ?? null,
        reorder_level: row.reorderLevel ?? procurement?.reorder_level ?? null,
        active: true,
        sort_order: index,
      };
    });
  }

  function productCatalogChanged(nextVariants: ReturnType<typeof buildProductVariantPayloads>) {
    if (!editingProductSnapshot) return true;
    const original = (editingProductSnapshot.variants || [])
      .filter(variant => variant.active !== false)
      .sort((left, right) => left.sort_order - right.sort_order || String(left.size).localeCompare(String(right.size)))
      .map((variant, index) => ({
        id: variant.id,
        variant_sku: variant.variant_sku,
        barcode: variant.barcode || "",
        size: String(variant.size || "ONE SIZE").trim().toUpperCase(),
        color: variant.color || "",
        quantity: Math.max(0, Math.trunc(Number(variant.quantity_on_hand) || 0)),
        price: variant.price ?? null,
        supplier_id: variant.supplier_id || null,
        supplier_sku: variant.supplier_sku?.trim() || "",
        cost_price: variant.cost_price ?? null,
        reorder_level: variant.reorder_level ?? null,
        active: true,
        sort_order: Number.isFinite(variant.sort_order) ? variant.sort_order : index,
      }));
    const desired = nextVariants.map((variant) => ({
      id: variant.id || null,
      variant_sku: variant.variant_sku,
      barcode: variant.barcode,
      size: variant.size,
      color: variant.color,
      quantity: variant.quantity,
      price: variant.price,
      supplier_id: variant.supplier_id,
      supplier_sku: variant.supplier_sku,
      cost_price: variant.cost_price,
      reorder_level: variant.reorder_level,
      active: variant.active,
      sort_order: variant.sort_order,
    }));
    return createProductOperationFingerprint(original) !== createProductOperationFingerprint(desired);
  }

  function resetProductEditor() {
    setForm(emptyProduct);
    setEditingId(null);
    setEditingProductSnapshot(null);
    setSizeStock({});
    setVariantMatrix([]);
    setVariantProcurement({});
    setNewMainFile(null);
    setNewGalleryFiles([]);
  }

  function cancelProductEditor() {
    const scope = editingId ? `editor:update:${editingId}` : "editor:create";
    try { productOperationIds().cancel(scope); } catch (error) {
      toast(error instanceof Error ? error.message : "无法清除商品操作状态。", "err");
      return;
    }
    resetProductEditor();
  }

  async function saveProductMetadata(
    product: AdminProduct,
    patch: Record<string, unknown>,
    scopeName: string,
  ) {
    const scope = `${scopeName}:${product.id}`;
    const requestPayload = {
      ...patch,
      expectedMetadataVersion: Number(product.metadata_version),
      expectedStructureVersion: Number(product.structure_version),
    };
    let operationId = "";
    try {
      const fingerprint = createProductOperationFingerprint(requestPayload);
      operationId = productOperationIds().getOrCreate(scope, fingerprint);
      productOperationIds().markAttempt(scope, operationId);
      const result = await api(`/api/admin/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...requestPayload, clientRequestId: operationId }),
      });
      try { productOperationIds().complete(scope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "商品已保存，但本地业务 ID 清理失败。", "err");
      }
      return result;
    } catch (error) {
      handleProductOperationFailure(scope, operationId, error);
      throw error;
    }
  }
  function addSize(sz: string) { setSizeStock(prev => { if (sz in prev) return prev; return { ...prev, [sz]: 0 }; }); setVariantProcurement(prev => prev[sz] ? prev : { ...prev, [sz]: { supplier_sku: "", cost_price: null, reorder_level: null } }); }
  function toggleSizeSummary() { setShowSizeSummary(prev => !prev); }
  function addMissingSizes() { const parts = form.sizes.split(/[\/,\s]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean); if (parts.length === 0) { toast("sizes 字段为空", "err"); return; } setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const s of parts) { if (!(s in next)) { next[s] = 0; added++; } } if (added > 0) { toast(`已补充 ${added} 个缺失尺码，已有库存不变`); return next; } toast("所有 sizes 尺码已在库存表中"); return prev; }); }
  function sortSizeKeys(keys: string[]) { return keys.sort((a,b) => { const ae = /^EU\s+(\d+(?:\.\d+)?)$/i.exec(a); const be = /^EU\s+(\d+(?:\.\d+)?)$/i.exec(b); if (ae && be) return Number(ae[1]) - Number(be[1]); const ai = sizeSortOrder.indexOf(a); const bi = sizeSortOrder.indexOf(b); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.localeCompare(b); }); }
  function addCustomSize() { const raw = prompt("输入尺码名称，多个用逗号分隔", ""); if (!raw) return; const names = raw.split(/[\/,\s]+/).map((x: string) => x.trim().toUpperCase()).filter(Boolean); if (names.length === 0) return; setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const k of names) { if (!(k in next)) { next[k] = 0; added++; } } if (added > 0) { toast(`已添加 ${added} 个尺码`); return next; } toast("所有尺码已存在"); return prev; }); }

  /* ── Translate ────────────────────────────────────────── */
  async function translateProduct() {
    if (!form.name_cn.trim() && !form.description_cn.trim()) { toast("请先填写中文名称或中文描述。", "err"); return; }
    if (form.name_gr || form.description_gr || form.name_en || form.description_en) { setConfirm({ open: true, title: "自动翻译", desc: "当前已有希腊语或英语内容，是否用自动翻译结果覆盖？", confirmText: "覆盖翻译", variant: "danger", action: () => { setConfirm(c => ({ ...c, open: false })); doTranslate(); } }); return; }
    doTranslate();
  }
  async function doTranslate() { setTranslating(true); try { const d = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: form.name_cn, description_cn: form.description_cn }) }) as TranslationResult; setForm(c => ({ ...c, name_gr: d.name_gr, description_gr: d.description_gr, name_en: d.name_en, description_en: d.description_en })); toast("翻译已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "自动翻译失败", "err"); } finally { setTranslating(false); } }
  async function generateProductCopy() {
    const localImages = [newMainFile, ...newGalleryFiles].filter((file): file is File => Boolean(file)).slice(0, maxProductVisionImages);
    const canUseStoredImages = Boolean(editingId && form.sku.trim() && (form.image_url.trim() || imageLines(form.image_urls).length > 0));
    if (localImages.length === 0 && !canUseStoredImages && !form.name_cn.trim() && !form.description_cn.trim() && !form.category && !form.subcategory) { toast("请先上传商品照片，或填写分类、商品名或备注。", "err"); return; }
    setAiCopyLoading(true);
    try {
      const d = await generateProductCopyRequest({
        sku: form.sku,
        name_cn: form.name_cn,
        description_cn: form.description_cn,
        category: form.category,
        subcategory: form.subcategory,
        color: matrixColors(variantMatrix).filter(Boolean).join(" / ") || form.color,
        brand: form.brand,
        material: form.material,
        sizes: form.sizes || sortSizeKeys(matrixSizes(variantMatrix).length > 0 ? matrixSizes(variantMatrix) : Object.keys(sizeStock)).join(","),
        use_stored_images: localImages.length === 0 && canUseStoredImages,
      }, localImages);
      setForm(c => ({
        ...c,
        name_cn: d.name_cn || c.name_cn,
        description_cn: d.description_cn || c.description_cn,
        name_gr: d.name_gr || c.name_gr,
        description_gr: d.description_gr || c.description_gr,
        name_en: d.name_en || c.name_en,
        description_en: d.description_en || c.description_en,
        material: d.material || c.material,
        fit_type: d.fit_type || c.fit_type,
        ai_keywords: d.ai_keywords || c.ai_keywords,
        style_tags: d.style_tags || c.style_tags,
        material_verified: d.material ? false : c.material_verified,
      }));
      toast(d.images_analyzed
        ? `已读取 ${d.images_analyzed} 张商品照片并生成资料，请检查后再保存。`
        : "AI 商品文案已生成，请检查后再保存。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI 文案生成失败", "err");
    } finally {
      setAiCopyLoading(false);
    }
  }
  async function generateAiMeta() { setAiMetaLoading(true); try { const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ product: { name_cn: form.name_cn, name_en: form.name_en, name_gr: form.name_gr, description_en: form.description_en, category: form.category, subcategory: form.subcategory, price: form.price, sizes: form.sizes } }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "生成失败"); setForm(c => ({ ...c, fit_type: d.fit_type || c.fit_type, material: d.material || c.material, ai_keywords: d.ai_keywords || c.ai_keywords, style_tags: d.style_tags || c.style_tags, material_verified: false })); toast("AI 导购信息已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "AI 生成失败", "err"); } finally { setAiMetaLoading(false); } }
  async function startAiComplete(p: AdminProduct) {
    const base = openProductForm(p);
    const needsTranslation = Boolean((base.name_cn.trim() || base.description_cn.trim()) && (!base.name_en.trim() || !base.description_en.trim() || !base.name_gr.trim() || !base.description_gr.trim()));
    const needsMeta = Boolean((base.name_cn.trim() || base.name_en.trim() || base.name_gr.trim()) && (!base.ai_keywords.trim() || !base.style_tags.trim() || !base.material.trim()));
    if (!needsTranslation && !needsMeta) { toast("这个商品暂时没有明显需要 AI 补全的字段。"); return; }
    setAutoCompletingId(p.id);
    try {
      let working = base;
      if (needsTranslation) {
        try {
          const translated = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: base.name_cn, description_cn: base.description_cn }) }) as TranslationResult;
          working = { ...working, name_en: working.name_en || translated.name_en, description_en: working.description_en || translated.description_en, name_gr: working.name_gr || translated.name_gr, description_gr: working.description_gr || translated.description_gr };
          setForm(c => ({ ...c, name_en: c.name_en || translated.name_en, description_en: c.description_en || translated.description_en, name_gr: c.name_gr || translated.name_gr, description_gr: c.description_gr || translated.description_gr }));
        } catch (e) {
          toast(e instanceof Error ? `翻译未完成：${e.message}` : "翻译未完成", "err");
        }
      }
      if (needsMeta) {
        try {
          const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ product: { name_cn: working.name_cn, name_en: working.name_en, name_gr: working.name_gr, description_en: working.description_en, category: working.category, subcategory: working.subcategory, price: working.price, sizes: working.sizes } }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "生成失败");
          setForm(c => ({ ...c, fit_type: d.fit_type || c.fit_type, material: c.material || d.material || "", ai_keywords: c.ai_keywords || d.ai_keywords || "", style_tags: c.style_tags || d.style_tags || "", material_verified: false }));
        } catch (e) {
          toast(e instanceof Error ? `AI 导购信息未完成：${e.message}` : "AI 导购信息未完成", "err");
        }
      }
      toast("AI 补全已填入表单，请检查后手动保存。");
    } finally {
      setAutoCompletingId(null);
    }
  }
  function confirmBatchAiComplete() {
    const targets = launchChecks.rows.map(row => row.product).filter(needsAiCompletion).slice(0, 20);
    if (targets.length === 0) { toast("暂无需要 AI 补全的商品。"); return; }
    setConfirm({
      open: true,
      title: "批量 AI 补全？",
      desc: `将处理 ${targets.length} 件商品，并调用 DeepSeek API。补全结果会直接保存到数据库。一次最多处理 20 件，避免费用失控。是否继续？`,
      confirmText: "确认补全",
      variant: "default",
      action: () => void executeBatchAiComplete(targets),
    });
  }
  async function executeBatchAiComplete(targets: AdminProduct[]) {
    setLoading(true);
    setConfirm(c => ({ ...c, open: true, confirmText: "补全中..." }));
    let ok = 0;
    let fail = 0;
    try {
      for (const product of targets) {
        try {
          const payload: Record<string, unknown> = {
            name_cn: product.name_cn,
            name_en: product.name_en,
            name_gr: product.name_gr,
            description_cn: product.description_cn,
            description_en: product.description_en,
            description_gr: product.description_gr,
            fit_type: product.fit_type,
            material: product.material,
            ai_keywords: product.ai_keywords,
            style_tags: product.style_tags,
            material_verified: product.material_verified,
          };
          const hasChinese = hasText(product.name_cn) || hasText(product.description_cn);
          if (hasChinese && (!hasText(product.name_en) || !hasText(product.description_en) || !hasText(product.name_gr) || !hasText(product.description_gr))) {
            const translated = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: product.name_cn, description_cn: product.description_cn }) }) as TranslationResult;
            payload.name_en = product.name_en || translated.name_en;
            payload.description_en = product.description_en || translated.description_en;
            payload.name_gr = product.name_gr || translated.name_gr;
            payload.description_gr = product.description_gr || translated.description_gr;
          }
          const raw = product as Record<string, unknown>;
          const hasKeywords = Array.isArray(raw.ai_keywords) ? raw.ai_keywords.length > 0 : hasText(raw.ai_keywords);
          const hasStyleTags = Array.isArray(raw.style_tags) ? raw.style_tags.length > 0 : hasText(raw.style_tags);
          if ((hasText(product.name_cn) || hasText(product.name_en) || hasText(product.name_gr)) && (!hasKeywords || !hasStyleTags || !hasText(raw.material))) {
            const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ product: { name_cn: payload.name_cn, name_en: payload.name_en, name_gr: payload.name_gr, description_en: payload.description_en, category: product.category, subcategory: product.subcategory, price: product.price, sizes: product.sizes } }) });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "AI 导购信息生成失败");
            if (d.fit_type) payload.fit_type = d.fit_type;
            if (!hasText(raw.material) && d.material) payload.material = d.material;
            if (!hasKeywords && d.ai_keywords) payload.ai_keywords = String(d.ai_keywords).split(/[,，\s]+/).filter(Boolean);
            if (!hasStyleTags && d.style_tags) payload.style_tags = String(d.style_tags).split(/[,，\s]+/).filter(Boolean);
            payload.material_verified = false;
          }
          await saveProductMetadata(product, payload, "ai-complete");
          ok++;
        } catch {
          fail++;
        }
      }
      toast(`批量 AI 补全完成：成功 ${ok}，失败 ${fail}`);
      await loadProducts();
    } finally {
      setLoading(false);
      setConfirm({ open: false, title: "", desc: "", confirmText: "", variant: "default", action: () => {} });
    }
  }

  /* ── Submit / Delete ──────────────────────────────────── */
  async function submitProduct(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!form.sku.trim()) { toast("请填写 SKU", "err"); return; } if (!form.name_cn.trim() && !form.name_en.trim() && !form.name_gr.trim()) { toast("请至少填写一个语言的商品名", "err"); return; } if (form.size_chart.trim()) { try { JSON.parse(form.size_chart.trim()); } catch { toast("尺码表 JSON 格式不正确，请检查", "err"); return; } }
if (!form.image_url && !newMainFile) { setConfirm({ open: true, title: "商品没有图片", desc: "该商品没有主图，是否继续保存？", confirmText: "继续保存", variant: "default", action: () => { setConfirm(c => ({ ...c, open: false })); doSubmit(); } }); return; } doSubmit(); }
  async function doSubmit() {
    setLoading(true);
    const p = normalizeProduct(form);
    const sizeKeys = sortSizeKeys(matrixSizes(variantMatrix));
    if (variantMatrix.length === 0 || sizeKeys.length === 0) {
      toast("请先选择尺码并填写库存", "err");
      setLoading(false);
      return;
    }
    const catalogKeys = variantMatrix.map(row => variantCatalogKey(row.size, row.color));
    if (new Set(catalogKeys).size !== catalogKeys.length) {
      toast("存在重复的颜色与尺码组合，请检查后再保存。", "err");
      setLoading(false);
      return;
    }

    const aiData: Record<string, unknown> = {};
    if (p.ai_keywords.trim()) aiData.ai_keywords = p.ai_keywords.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (p.style_tags.trim()) aiData.style_tags = p.style_tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (p.size_chart.trim()) aiData.size_chart = JSON.parse(p.size_chart.trim());
    if (p.fit_type) aiData.fit_type = p.fit_type;
    aiData.material_verified = p.material_verified === true;

    const productBasePriceChanged = Boolean(
      editingProductSnapshot
      && Number(p.price) !== Number(editingProductSnapshot.price),
    );
    const variants = buildProductVariantPayloads(productBasePriceChanged);
    const legacySizeStock = matrixSizeStock(variantMatrix);
    const colors = matrixColors(variantMatrix).filter(Boolean);
    const catalogChanged = productCatalogChanged(variants) || productBasePriceChanged;
    const payload: Record<string, unknown> = {
      ...(p as Record<string, unknown>),
      ...aiData,
      sizes: sortSizeKeys([...sizeKeys]).join(","),
      size_stock: legacySizeStock,
      stock: matrixTotal(variantMatrix),
      color: colors[0] || p.color.trim(),
      variant_procurement: variantProcurement,
      ...(editingId
        ? {
            expectedMetadataVersion: Number(editingProductSnapshot?.metadata_version),
            expectedStructureVersion: Number(editingProductSnapshot?.structure_version),
            ...(catalogChanged ? { variants } : {}),
          }
        : { variants }),
    };
    const scope = editingId ? `editor:update:${editingId}` : "editor:create";
    const fingerprint = createProductOperationFingerprint(payload);
    const url = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products";
    const method = editingId ? "PUT" : "POST";
    let operationId = "";

    try {
      operationId = productOperationIds().getOrCreate(scope, fingerprint);
      productOperationIds().markAttempt(scope, operationId);
      const saved = await api(url, {
        method,
        body: JSON.stringify({ ...payload, clientRequestId: operationId }),
      });
      try { productOperationIds().complete(scope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "商品已保存，但本地业务 ID 清理失败。", "err");
      }
      toast(editingId ? "商品已更新" : "商品已新增");
      if (saved?.cacheWarning) toast(String(saved.cacheWarning), "err");

      if (!editingId && (newMainFile || newGalleryFiles.length > 0)) {
        const sku = saved?.product?.sku || form.sku;
        let imgOk = 0;
        let imgFail = 0;
        const imgErrors: string[] = [];
        try {
          if (newMainFile) {
            const fd = new FormData();
            fd.append("images", newMainFile);
            fd.append("sku", sku);
            fd.append("mode", "main");
            const r = await fetch("/api/admin/images", { method: "POST", headers: adminAuthHeaders(), body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(String(d.error || "主图上传失败"));
            const results = (Array.isArray(d.results) ? d.results : []) as ApiResult[];
            if (results.length === 0) {
              imgFail++;
              imgErrors.push(String(d.error || "主图上传没有返回文件结果"));
            }
            for (const res of results) {
              if (res.ok) imgOk++;
              else { imgFail++; if (res.message) imgErrors.push(res.message); }
            }
          }
          if (newGalleryFiles.length > 0) {
            const fd = new FormData();
            newGalleryFiles.forEach(file => fd.append("images", file));
            fd.append("sku", sku);
            fd.append("mode", "gallery");
            const r = await fetch("/api/admin/images", { method: "POST", headers: adminAuthHeaders(), body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(String(d.error || "商品多图上传失败"));
            const results = (Array.isArray(d.results) ? d.results : []) as ApiResult[];
            if (results.length === 0) {
              imgFail += newGalleryFiles.length;
              imgErrors.push(String(d.error || "商品多图上传没有返回文件结果"));
            }
            for (const res of results) {
              if (res.ok) imgOk++;
              else { imgFail++; if (res.message) imgErrors.push(res.message); }
            }
          }
          if (imgFail > 0) {
            toast(`商品已保存。图片：成功 ${imgOk}，失败 ${imgFail}${imgErrors.length > 0 ? `（${imgErrors.join("；")}）` : ""}`, "err");
          } else {
            toast("商品已保存，图片已上传");
          }
        } catch {
          toast("商品已保存，图片上传失败；请从图片管理重试，不要重复新增商品。", "err");
        }
      }

      resetProductEditor();
      setTab("dashboard");
      await loadProducts();
    } catch (error) {
      handleProductOperationFailure(scope, operationId, error);
      toast(error instanceof Error ? error.message : "保存失败", "err");
    } finally {
      setLoading(false);
    }
  }
  function confirmDeleteProduct(p: AdminProduct) { setConfirm({ open: true, title: "确认下架商品？", desc: `下架 ${p.sku} 后商品将不会在前台显示，但数据会保留，之后可以恢复上架。`, confirmText: "确认下架", variant: "danger", action: () => executeDelete(p) }); }
  async function executeDelete(p: AdminProduct) {
    setLoading(true);
    const scope = `archive:${p.id}`;
    const requestPayload = {
      expectedMetadataVersion: Number(p.metadata_version),
      expectedStructureVersion: Number(p.structure_version),
    };
    let operationId = "";
    try {
      const fingerprint = createProductOperationFingerprint(requestPayload);
      operationId = productOperationIds().getOrCreate(scope, fingerprint);
      productOperationIds().markAttempt(scope, operationId);
      const result = await api(`/api/admin/products/${p.id}`, {
        method: "DELETE",
        body: JSON.stringify({ ...requestPayload, clientRequestId: operationId }),
      });
      try { productOperationIds().complete(scope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "商品已下架，但本地业务 ID 清理失败。", "err");
      }
      if (result?.cacheWarning) toast(String(result.cacheWarning), "err");
      toast("商品已下架");
      setConfirm(c => ({ ...c, open: false }));
      await loadProducts();
    } catch (error) {
      handleProductOperationFailure(scope, operationId, error);
      toast(error instanceof Error ? error.message : "下架失败", "err");
    } finally {
      setLoading(false);
    }
  }
  function confirmRestoreProduct(p: AdminProduct) { setConfirm({ open: true, title: "确认恢复上架？", desc: `恢复上架 ${p.sku} 后商品会重新在前台显示。`, confirmText: "确认恢复", variant: "success", action: () => executeRestore(p) }); }
  async function executeRestore(p: AdminProduct) { setLoading(true); try { const result = await saveProductMetadata(p, { is_active: true }, "restore"); if (result?.cacheWarning) toast(String(result.cacheWarning), "err"); toast("商品已恢复上架"); setConfirm(c => ({ ...c, open: false })); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "恢复失败", "err"); } finally { setLoading(false); } }
  async function permanentDelete(p: AdminProduct) { const input = window.prompt(`永久删除商品 ${p.sku}？\n\n此操作不可恢复！请输入 DELETE 确认：`); if (input !== "DELETE") { if (input !== null) toast("输入错误，已取消", "err"); return; } setLoading(true); try { await api(`/api/admin/products/${p.id}/permanent`, { method: "DELETE" }); toast("商品已永久删除"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "删除失败", "err"); } finally { setLoading(false); } }

  function toggleSelect(id: string) { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function selectAll() { if (selectedIds.size === filteredProducts.slice(0, 100).length) { setSelectedIds(new Set()); } else { setSelectedIds(new Set(filteredProducts.slice(0, 100).map(p => p.id))); } }
  function dismissConfirm() { setConfirm({ open: false, title: "", desc: "", confirmText: "", variant: "default", action: () => {} }); }

  function confirmBatch(isActive: boolean) { const ids = Array.from(selectedIds); if (ids.length === 0) { toast("请先选择商品", "err"); return; } setConfirm({ open: true, title: isActive ? "确认批量恢复上架？" : "确认批量下架？", desc: isActive ? `你将恢复上架选中的 ${ids.length} 个商品。恢复后商品会重新在前台显示。` : `你将下架选中的 ${ids.length} 个商品。下架后商品不会在前台显示，但数据会保留，可后续恢复上架。`, confirmText: isActive ? "确认恢复" : "确认下架", variant: isActive ? "success" : "danger", action: () => executeBatch(isActive, ids) }); }
  async function executeBatch(isActive: boolean, ids: string[]) {
    const label = isActive ? "恢复上架" : "下架";
    const items = ids
      .map(id => products.find(product => product.id === id))
      .filter((product): product is AdminProduct => Boolean(product))
      .map(product => ({
        productId: Number(product.id),
        expectedMetadataVersion: Number(product.metadata_version),
        expectedStructureVersion: Number(product.structure_version),
        isActive,
      }))
      .sort((left, right) => left.productId - right.productId);
    if (items.length !== ids.length) {
      toast("部分商品已不在当前列表，请刷新后重试。", "err");
      return;
    }

    const scope = "bulk:status";
    const fingerprint = createProductOperationFingerprint(items);
    let operationId = "";
    setLoading(true);
    setConfirm(c => ({ ...c, open: true, confirmText: "处理中..." }));
    try {
      operationId = productOperationIds().getOrCreate(scope, fingerprint);
      productOperationIds().markAttempt(scope, operationId);
      const result = await api("/api/admin/products/bulk", {
        method: "PUT",
        body: JSON.stringify({ clientRequestId: operationId, items }),
      });
      try { productOperationIds().complete(scope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "批量操作已完成，但本地业务 ID 清理失败。", "err");
      }
      if (result?.cacheWarning) toast(String(result.cacheWarning), "err");
      toast(`已${label} ${items.length} 个商品`);
      setSelectedIds(new Set());
      await loadProducts();
    } catch (error) {
      handleProductOperationFailure(scope, operationId, error);
      toast(error instanceof Error ? error.message : `批量${label}失败`, "err");
    } finally {
      setLoading(false);
      setConfirm({ open: false, title: "", desc: "", confirmText: "", variant: "default", action: () => {} });
    }
  }

  async function batchGenerateAiMeta() { const ids = Array.from(selectedIds); if (ids.length === 0) { toast("请先选择商品", "err"); return; } const targets = products.filter(p => ids.includes(p.id) && (p.name_cn?.trim() || p.name_en?.trim())); const skipped = ids.length - targets.length; setLoading(true); let ok = 0; let fail = 0; for (const p of targets) { try { const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ product: { name_cn: p.name_cn, name_en: p.name_en, name_gr: p.name_gr, description_en: (p as Record<string,unknown>).description_en, category: p.category, subcategory: p.subcategory, price: p.price, sizes: p.sizes } }) }); const d = await r.json(); if (r.ok) { const payload: Record<string, unknown> = {}; if (d.fit_type) payload.fit_type = d.fit_type; if (d.material) payload.material = d.material; payload.material_verified = false; if (d.ai_keywords) { const kw = d.ai_keywords.split(/[,，\s]+/).filter(Boolean); payload.ai_keywords = kw; } if (d.style_tags) { const st = d.style_tags.split(/[,，\s]+/).filter(Boolean); payload.style_tags = st; } await saveProductMetadata(p, payload, "ai-meta"); ok++; } else { fail++; } } catch { fail++; } } if (skipped > 0) toast(`完成：成功 ${ok}，失败 ${fail}。跳过 ${skipped} 个（无名称）`); else toast(`完成：成功 ${ok}，失败 ${fail}`); setSelectedIds(new Set()); setLoading(false); await loadProducts(); }

  /* ── CSV ──────────────────────────────────────────────── */
  async function previewCsvFile(
    file: File,
    importMode = csvImportMode,
    inventoryMode = csvInventoryMode,
  ) {
    const sequence = ++csvPreviewSequenceRef.current;
    setCsvBusy("preview");
    setCsvPreviewError("");
    setCsvPreview(null);
    setCsvTranslations([]);
    setCsvTranslationFailures(0);
    const body = new FormData();
    body.append("file", file);
    body.append("importMode", importMode);
    body.append("inventoryMode", inventoryMode);
    try {
      const data = await csvFetchJson("/api/admin/products/import/preview", { method: "POST", body });
      if (sequence !== csvPreviewSequenceRef.current) return;
      setCsvPreview(data as unknown as CsvPreview);
    } catch (error) {
      if (sequence !== csvPreviewSequenceRef.current) return;
      setCsvPreviewError(error instanceof Error ? error.message : "CSV 服务端预览失败");
    } finally {
      if (sequence === csvPreviewSequenceRef.current) setCsvBusy(null);
    }
  }

  async function handleCsv(file: File | null) {
    if (!file) {
      setCsvFile(null);
      setCsvPreview(null);
      setCsvTranslations([]);
      setCsvTranslationFailures(0);
      return;
    }
    try {
      const pending = csvOperationIds().getPending();
      if (pending?.attempted) {
        setCsvHasPendingOperation(true);
        setCsvPreviewError("上一项 CSV 导入可能已经写入数据。请先恢复并完成该 Job，不能直接换文件生成新业务 ID。");
        if (csvFileInputRef.current) csvFileInputRef.current.value = "";
        await recoverPendingCsvImport(false);
        return;
      }
      if (pending) csvOperationIds().cancel();
      setCsvHasPendingOperation(false);
    } catch (error) {
      setCsvPreviewError(error instanceof Error ? error.message : "CSV 业务状态无法读取");
      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
      return;
    }
    setCsvJobView(null);
    setCsvFile(file);
    await previewCsvFile(file);
  }

  async function changeCsvModes(
    importMode: ProductCsvImportMode,
    inventoryMode: ProductCsvInventoryMode,
  ) {
    if (csvHasPendingOperation) {
      toast("当前 CSV Job 尚未结束，不能更改导入模式。", "err");
      return;
    }
    setCsvImportMode(importMode);
    setCsvInventoryMode(inventoryMode);
    setCsvTranslations([]);
    setCsvTranslationFailures(0);
    if (csvFile) await previewCsvFile(csvFile, importMode, inventoryMode);
  }

  function rowsNeedingCsvTranslation() {
    const translationsByRow = new Map(csvTranslations.map(result => [result.rowNumber, result]));
    return (csvPreview?.rows || []).filter(row => {
      const translated = translationsByRow.get(row.rowNumber);
      const sourceName = String(row.metadata.name_cn || "").trim();
      const sourceDescription = String(row.metadata.description_cn || "").trim();
      if (!sourceName && !sourceDescription) return false;
      return !String(translated?.translated ? translated.name_en : row.metadata.name_en || "").trim()
        || !String(translated?.translated ? translated.description_en : row.metadata.description_en || "").trim()
        || !String(translated?.translated ? translated.name_gr : row.metadata.name_gr || "").trim()
        || !String(translated?.translated ? translated.description_gr : row.metadata.description_gr || "").trim();
    });
  }

  async function translateCsvPreview() {
    if (!csvPreview) return;
    if (csvPreview.previewTruncated) {
      toast("超过 100 行时预览接口不会返回全部内容。为避免只翻译部分商品，请先在 CSV 中填写译文或拆分文件。", "err");
      return;
    }
    const rows = rowsNeedingCsvTranslation();
    if (rows.length === 0) {
      toast("当前 CSV 不需要补充英文或希腊语译文。", "ok");
      return;
    }
    setCsvBusy("translate");
    setCsvPreviewError("");
    const results: CsvTranslationResult[] = [];
    try {
      for (let index = 0; index < rows.length; index += 50) {
        const batch = rows.slice(index, index + 50).map(row => ({
          rowNumber: row.rowNumber,
          name_cn: String(row.metadata.name_cn || ""),
          description_cn: String(row.metadata.description_cn || ""),
          name_en: String(row.metadata.name_en || ""),
          description_en: String(row.metadata.description_en || ""),
          name_gr: String(row.metadata.name_gr || ""),
          description_gr: String(row.metadata.description_gr || ""),
        }));
        const data = await csvFetchJson("/api/admin/products/import/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        results.push(...((data.results || []) as CsvTranslationResult[]));
      }
      const mergedTranslations = new Map(csvTranslations.map(result => [result.rowNumber, result]));
      for (const result of results) mergedTranslations.set(result.rowNumber, result);
      const nextTranslations = Array.from(mergedTranslations.values()).sort((left, right) => left.rowNumber - right.rowNumber);
      setCsvTranslations(nextTranslations);
      setCsvTranslationFailures(nextTranslations.filter(result => Boolean(result.translateError)).length);
      const succeeded = results.filter(result => result.translated).length;
      const failed = results.filter(result => Boolean(result.translateError)).length;
      toast(`翻译完成：成功 ${succeeded}，失败 ${failed}${failed > 0 ? "。失败行不会覆盖 CSV 原值。" : ""}`, failed > 0 ? "err" : "ok");
    } catch (error) {
      setCsvPreviewError(error instanceof Error ? error.message : "CSV 翻译失败");
      toast(error instanceof Error ? error.message : "CSV 翻译失败", "err");
    } finally {
      setCsvBusy(null);
    }
  }

  function confirmImportCsv() {
    if (!csvFile || !csvPreview) {
      toast("请先选择 CSV 文件并通过服务端预览。", "err");
      return;
    }
    const importLabel = csvImportMode === "create_only" ? "仅新增" : csvImportMode === "update_existing" ? "仅更新已有商品" : "新增或更新";
    const inventoryLabel = csvInventoryMode === "metadata_only" ? "只改商品资料，不改库存" : "按 CSV 设置库存";
    setConfirm({
      open: true,
      title: "确认创建 CSV 导入 Job？",
      desc: `文件 ${csvPreview.filename}，共 ${csvPreview.rowCount} 行。模式：${importLabel}；${inventoryLabel}。提交后会保留同一个业务 ID，网络异常时请恢复 Job，不要重新上传。`,
      confirmText: "确认导入",
      variant: csvInventoryMode === "set_inventory" || csvImportMode === "upsert" ? "danger" : "default",
      action: () => {
        setConfirm(current => ({ ...current, open: false }));
        void executeImportCsv();
      },
    });
  }

  async function executeImportCsv() {
    if (!csvFile || !csvPreview) return;
    let operationId = "";
    setCsvBusy("submit");
    setCsvPreviewError("");
    try {
      operationId = csvOperationIds().getOrCreate(csvOperationFingerprint());
      const body = new FormData();
      body.append("file", csvFile);
      body.append("importMode", csvImportMode);
      body.append("inventoryMode", csvInventoryMode);
      body.append("operationId", operationId);
      const translations = csvTranslationPayload();
      if (translations.length > 0) body.append("translations", JSON.stringify(translations));
      csvOperationIds().markAttempt(operationId);
      setCsvHasPendingOperation(true);
      const data = await csvFetchJson("/api/admin/products/import", { method: "POST", body });
      const view = acceptCsvJobView(data, operationId);
      toast(`CSV Job：成功 ${view.job.succeeded_rows}，失败 ${view.job.failed_rows}，待处理 ${view.job.pending_rows}`);
      await loadProducts();
    } catch (error) {
      if (error instanceof AdminApiError && error.jobId && operationId) {
        try { csvOperationIds().attachJob(operationId, error.jobId); } catch {}
      }
      if (error instanceof AdminApiError && error.operationSafeToDiscard && operationId) {
        try {
          csvOperationIds().discardKnownNoWrite(operationId);
          setCsvHasPendingOperation(false);
        } catch {}
      }
      const message = error instanceof CsvImportOperationStateError
        ? error.message
        : error instanceof Error ? error.message : "CSV 导入失败";
      const operationResultUnknown = Boolean(operationId)
        && !(error instanceof AdminApiError && error.operationSafeToDiscard);
      setCsvPreviewError(`${message}${operationResultUnknown ? " 原业务 ID 已保留，请点击恢复状态。" : ""}`);
      toast(message, "err");
    } finally {
      setCsvBusy(null);
    }
  }

  async function processCsvJob(action: "process" | "retry" | "refresh") {
    const job = csvJobView?.job;
    if (!job) return;
    setCsvBusy(action === "refresh" ? "recover" : action);
    setCsvPreviewError("");
    try {
      const path = action === "refresh"
        ? `/api/admin/products/import/jobs/${encodeURIComponent(job.id)}`
        : `/api/admin/products/import/jobs/${encodeURIComponent(job.id)}/${action}`;
      const data = await csvFetchJson(path, action === "refresh" ? {} : { method: "POST" });
      const view = acceptCsvJobView(data, job.client_request_id);
      toast(`CSV Job：成功 ${view.job.succeeded_rows}，失败 ${view.job.failed_rows}，待处理 ${view.job.pending_rows}`);
      if (action !== "refresh" || Number(view.processed || 0) > 0) await loadProducts();
    } catch (error) {
      setCsvPreviewError(`${error instanceof Error ? error.message : "CSV Job 操作失败"} 原业务 ID 已保留，请刷新状态后再决定。`);
      toast(error instanceof Error ? error.message : "CSV Job 操作失败", "err");
    } finally {
      setCsvBusy(null);
    }
  }

  async function downloadCsvErrors() {
    const job = csvJobView?.job;
    if (!job) return;
    setCsvBusy("download");
    try {
      const response = await fetch(`/api/admin/products/import/jobs/${encodeURIComponent(job.id)}/errors.csv`, {
        headers: adminAuthHeaders(),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof data.error === "string" ? data.error : "失败明细下载失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `csv-import-errors-${job.id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error instanceof Error ? error.message : "失败明细下载失败", "err");
    } finally {
      setCsvBusy(null);
    }
  }

  function finishReviewedCsvJob() {
    const job = csvJobView?.job;
    if (!job || job.pending_rows > 0) return;
    setConfirm({
      open: true,
      title: "确认已核对 CSV Job？",
      desc: `该 Job 成功 ${job.succeeded_rows} 行、失败 ${job.failed_rows} 行。只有在已下载失败明细并确认无需继续重试后，才开始新的 CSV 文件。`,
      confirmText: "已核对，开始新文件",
      variant: "danger",
      action: () => {
        try {
          csvOperationIds().complete(job.client_request_id);
          setCsvHasPendingOperation(false);
          setCsvJobView(null);
          setCsvFile(null);
          setCsvPreview(null);
          setCsvTranslations([]);
          setCsvTranslationFailures(0);
          setCsvPreviewError("");
          if (csvFileInputRef.current) csvFileInputRef.current.value = "";
          toast("CSV Job 已结束，可以选择新文件。", "ok");
        } catch (error) {
          toast(error instanceof Error ? error.message : "CSV 业务 ID 清理失败", "err");
        } finally {
          setConfirm(current => ({ ...current, open: false }));
        }
      },
    });
  }

  async function downloadProductBackup() {
    try {
      const response = await fetch("/api/admin/backup", { headers: adminAuthHeaders() });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof data.error === "string" ? data.error : "商品 CSV 导出失败");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : plainName || `products-export-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error instanceof Error ? error.message : "商品 CSV 导出失败", "err");
    }
  }

  /* ── Image upload ──────────────────────────────────────── */
  async function uploadImages(files: FileList | null, opts: ImageUploadOptions = {}) { setImageResults([]); if (!files || files.length === 0) return; if (opts.sku && !opts.mode) { toast("请选择上传类型。", "err"); return; } try { setLoading(true); const body = new FormData(); Array.from(files).forEach(f => body.append("images", f)); if (opts.sku) body.append("sku", opts.sku); if (opts.mode) body.append("mode", opts.mode); const r = await fetch("/api/admin/images", { method: "POST", headers: adminAuthHeaders(), body }); const d = await readJson(r, "图片上传接口错误"); if (!r.ok) throw new Error(d.error || "图片上传失败"); setImageResults(d.results||[]); const okCount = (d.results||[]).filter((r: ApiResult) => r.ok).length; const failCount = (d.results||[]).filter((r: ApiResult) => !r.ok).length; const failReasons = (d.results||[]).filter((r: ApiResult) => !r.ok).map((r: ApiResult) => r.message).filter(Boolean); const summary = failReasons.length > 0 ? `失败原因：${failReasons.join("；")}` : ""; toast(`图片处理完成：成功 ${okCount}，失败 ${failCount}${summary ? `。${summary}` : ""}`); syncFormAfterUpload(opts, d); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "图片上传失败", "err"); } finally { setLoading(false); } }
  function syncFormAfterUpload(opts: ImageUploadOptions, d: Record<string, unknown>) { if (!editingIdRef.current || form.sku !== opts.sku) return; const results = (d.results || []) as ApiResult[]; if (opts.mode === "main" && results.length > 0 && results[0].imageUrl) { setForm(c => ({ ...c, image_url: results[0].imageUrl! })); } else if (opts.mode === "gallery" && results.length > 0) { const newUrls = results.filter(r => r.ok && r.imageUrl).map(r => r.imageUrl!); if (newUrls.length > 0) { setForm(c => { const existing = imageLines(c.image_urls); const seen = new Set([c.image_url.trim(), ...existing]); const toAdd = newUrls.filter(u => !seen.has(u)); return toAdd.length > 0 ? { ...c, image_urls: [...existing, ...toAdd].join("\n") } : c; }); } } }
  function confirmDeleteImage(opts: ImageDeleteOptions) { const label = opts.kind === "main" ? "主图" : "这张多图"; setConfirm({ open: true, title: `确定删除${label}？`, desc: "Storage 文件也会一起删除。", confirmText: "确认删除", variant: "danger", action: () => { setConfirm(c => ({ ...c, open: false })); executeDeleteImage(opts, label); } }); }
  async function executeDeleteImage(opts: ImageDeleteOptions, label: string) { setLoading(true); try { const r = await fetch("/api/admin/images", { method: "DELETE", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(opts) }); const d = await readJson(r, "删除图片接口错误"); if (!r.ok) throw new Error(d.error || "删除图片失败"); toast(`${label}已删除。`); await loadProducts(); if (editingIdRef.current && form.sku === opts.sku) { setForm(c => { if (opts.kind === "main") return { ...c, image_url: "" }; const next = imageLines(c.image_urls).filter((_, i) => i !== opts.index); return { ...c, image_urls: next.join("\n") }; }); } } catch (er) { toast(er instanceof Error ? er.message : "删除图片失败", "err"); } finally { setLoading(false); } }

  async function submitQuickAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quickMainFile) { toast("请先拍摄或选择一张主图", "err"); return; }
    if (!Number.isFinite(Number(quickAdd.price)) || Number(quickAdd.price) <= 0) { toast("请填写正确价格", "err"); return; }
    const sku = quickSku();
    const parsedSizeStock = parseSizeStockText(quickAdd.size_stock);
    const matrix = quickVariantMatrix.length > 0
      ? quickVariantMatrix
      : Object.entries(parsedSizeStock).map(([size, quantity]) => ({ size, color: quickAdd.color, quantity }));
    const sizeKeys = sortSizeKeys(matrixSizes(matrix));
    if (matrix.length === 0 || sizeKeys.length === 0) { toast("请先选择尺码并填写库存", "err"); return; }
    const catalogKeys = matrix.map(row => variantCatalogKey(row.size, row.color));
    if (new Set(catalogKeys).size !== catalogKeys.length) { toast("存在重复的颜色与尺码组合，请检查后再保存。", "err"); return; }
    const colors = matrixColors(matrix);
    const variants = [...matrix]
      .sort((left, right) => {
        const colorOrder = colors.findIndex(color => color.toLocaleLowerCase() === normalizeVariantColor(left.color).toLocaleLowerCase())
          - colors.findIndex(color => color.toLocaleLowerCase() === normalizeVariantColor(right.color).toLocaleLowerCase());
        if (colorOrder !== 0) return colorOrder;
        return sizeKeys.indexOf(normalizeVariantSize(left.size)) - sizeKeys.indexOf(normalizeVariantSize(right.size));
      })
      .map((row, index) => {
        const variantSku = buildVariantSku(sku, row.size, row.color);
        return {
          variant_sku: variantSku,
          barcode: variantSku,
          size: normalizeVariantSize(row.size),
          color: normalizeVariantColor(row.color),
          quantity: Math.max(0, Math.trunc(Number(row.quantity) || 0)),
          price: null,
          cost_price: null,
          supplier_id: null,
          supplier_sku: "",
          reorder_level: null,
          active: true,
          sort_order: index,
        };
      });
    const legacySizeStock = matrixSizeStock(matrix);
    const stock = matrixTotal(matrix);
    const payload: Record<string, unknown> = {
      sku,
      category: quickAdd.category,
      subcategory: quickAdd.subcategory,
      price: Number(quickAdd.price),
      stock,
      sizes: sortSizeKeys(sizeKeys).join(","),
      size_system: quickAdd.size_system,
      size_stock: legacySizeStock,
      name_cn: quickAdd.name_cn.trim() || `${colors[0] ? `${colors[0]} ` : ""}${quickAdd.category} ${quickAdd.subcategory}`,
      description_cn: quickAdd.description_cn.trim() || quickAdd.notes.trim() || "请在保存后检查并补充商品描述。",
      name_en: quickAdd.name_en.trim(),
      name_gr: quickAdd.name_gr.trim(),
      description_en: quickAdd.description_en.trim(),
      description_gr: quickAdd.description_gr.trim(),
      brand: quickAdd.brand.trim(),
      color: colors.find(Boolean) || quickAdd.color.trim(),
      vat: FIXED_PRODUCT_VAT_RATE,
      image_url: "",
      image_urls: "",
      is_active: quickAdd.is_active,
      fit_type: quickAdd.fit_type || "regular",
      material: quickAdd.material.trim(),
      ai_keywords: quickAdd.ai_keywords.trim() ? quickAdd.ai_keywords.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) : [],
      style_tags: quickAdd.style_tags.trim() ? quickAdd.style_tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) : [],
      material_verified: false,
      variants,
    };
    const scope = "quick-add:create";
    const fingerprint = createProductOperationFingerprint(payload);
    let operationId = "";
    setQuickSaving(true);
    try {
      try {
        operationId = productOperationIds().getOrCreate(scope, fingerprint);
        productOperationIds().markAttempt(scope, operationId);
      } catch (error) {
        handleProductOperationFailure(scope, operationId, error);
        throw error;
      }
      let saved;
      try {
        saved = await api("/api/admin/products", {
          method: "POST",
          body: JSON.stringify({ ...payload, clientRequestId: operationId }),
        });
      } catch (error) {
        handleProductOperationFailure(scope, operationId, error);
        throw error;
      }
      try { productOperationIds().complete(scope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "商品已新增，但本地业务 ID 清理失败。", "err");
      }
      const savedSku = saved?.product?.sku || sku;
      let imageFailure = "";
      try {
        const main = new FormData();
        main.append("images", quickMainFile);
        main.append("sku", savedSku);
        main.append("mode", "main");
        const mainResult = await fetch("/api/admin/images", { method: "POST", headers: adminAuthHeaders(), body: main });
        const mainData = await readJson(mainResult, "主图上传失败");
        if (!mainResult.ok) throw new Error(mainData.error || "主图上传失败");
        {
          const results = (Array.isArray(mainData.results) ? mainData.results : []) as ApiResult[];
          if (results.length === 0 || results.some(result => !result.ok)) {
            throw new Error(results.find(result => !result.ok)?.message || mainData.error || "主图上传失败");
          }
        }
        if (quickBackFiles.length > 0) {
          const gallery = new FormData();
          quickBackFiles.forEach(file => gallery.append("images", file));
          gallery.append("sku", savedSku);
          gallery.append("mode", "gallery");
          const galleryResult = await fetch("/api/admin/images", { method: "POST", headers: adminAuthHeaders(), body: gallery });
          const galleryData = await readJson(galleryResult, "多图上传失败");
          if (!galleryResult.ok) throw new Error(galleryData.error || "多图上传失败");
          const results = (Array.isArray(galleryData.results) ? galleryData.results : []) as ApiResult[];
          if (results.length === 0 || results.some(result => !result.ok)) {
            throw new Error(results.find(result => !result.ok)?.message || galleryData.error || "多图上传失败");
          }
        }
      } catch (error) {
        imageFailure = error instanceof Error ? error.message : "图片上传失败";
      }
      if (saved?.cacheWarning) toast(String(saved.cacheWarning), "err");
      if (imageFailure) {
        toast(`商品 ${savedSku} 已新增，但${imageFailure}。请从图片管理重试，不要重复新增商品。`, "err");
      } else {
        toast(`快速上新完成：${savedSku}`);
      }
      setQuickAdd(emptyQuickAdd);
      setQuickSizeStock({});
      setQuickVariantMatrix([]);
      setQuickMainFile(null);
      setQuickBackFiles([]);
      await loadProducts();
      setSearch(savedSku);
      setTab("dashboard");
    } catch (er) {
      toast(er instanceof Error ? er.message : "快速上新失败", "err");
    } finally {
      setQuickSaving(false);
    }
  }

  async function sellOne(product: AdminProduct, size?: string) {
    const sellingKey = `${product.sku}:${size || ""}`;
    const operationScope = `quick-sell:${product.sku}:${size || "ONE SIZE"}`;
    const fingerprint = JSON.stringify({ sku: product.sku, size: size || null, quantity: 1, autoDeactivate: true });
    let operationId = "";
    setSellingSku(sellingKey);
    try {
      operationId = quickSellOperationIds().getOrCreate(operationScope, fingerprint);
      quickSellOperationIds().markAttempt(operationScope, operationId);
      const result = await api("/api/admin/products/sell", {
        method: "POST",
        body: JSON.stringify({ sku: product.sku, size, quantity: 1, autoDeactivate: true, clientRequestId: operationId }),
      });
      try { quickSellOperationIds().complete(operationScope, operationId); } catch (storageError) {
        toast(storageError instanceof Error ? storageError.message : "售出成功，但本地业务 ID 清理失败。", "err");
      }
      if (result.erpSyncWarning) {
        toast(`旧库存已更新，但 ERP 库存同步需要检查：${result.erpSyncWarning}`, "err");
      } else if (result.alreadyProcessed) {
        toast("这次售出请求已经处理过，没有重复扣库存。");
      }
      toast(size ? `${product.sku} / ${size} 已售出 1 件` : `${product.sku} 已售出 1 件`);
      await loadProducts();
    } catch (er) {
      toast(er instanceof Error ? er.message : "减库存失败", "err");
      if (operationId) handleInventoryOperationFailure(quickSellOperationIds(), operationScope, operationId, er);
    } finally {
      setSellingSku(null);
    }
  }

  async function generateStyleImageForCurrentProduct() {
    if (!form.sku.trim()) { toast("请先选择商品", "err"); return; }
    setStyleImageSku(form.sku);
    try {
      const d = await api("/api/admin/products/style-image", {
        method: "POST",
        body: JSON.stringify({ sku: form.sku, style: styleImageStyle, modelType: styleImageModelType }),
      });
      if (d.imageUrl) {
        setForm(c => {
          const existing = imageLines(c.image_urls);
          return { ...c, image_urls: Array.from(new Set([...existing, d.imageUrl])).join("\n") };
        });
      }
      const generatedImage = d.image && typeof d.image === "object" ? d.image as Record<string, unknown> : null;
      const generatedSize = generatedImage?.width && generatedImage?.height ? `（${generatedImage.width}×${generatedImage.height} ${String(generatedImage.format || "").toUpperCase()}）` : "";
      toast(`AI 模特图已生成${generatedSize}，并加入多图。`);
      await loadProducts();
    } catch (er) {
      toast(er instanceof Error ? er.message : "AI 模特图生成失败", "err");
    } finally {
      setStyleImageSku(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      let sessionHeaders: Record<string, string>;
      if (loginMode === "account") {
        const supabase = getSupabaseBrowserAuthClient();
        if (!supabase) throw new Error("Supabase 登录环境未配置");
        const { data, error } = await supabase.auth.signInWithPassword({
          email: loginEmail.trim(),
          password: accountPassword,
        });
        if (error || !data.session?.access_token) {
          throw new Error(error?.message || "员工账号登录失败");
        }
        sessionHeaders = { Authorization: `Bearer ${data.session.access_token}` };
        setAdminAuthToken(data.session.access_token);
        setActivePassword("");
      } else {
        const supabase = getSupabaseBrowserAuthClient();
        if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        sessionHeaders = { "x-admin-password": password };
        setAdminAuthToken("");
      }

      const response = await fetch("/api/admin/session", { headers: sessionHeaders });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败");
      setAdminSession({
        role: data.role,
        permissions: data.permissions || [],
        authType: data.authType,
        email: data.email || null,
        displayName: data.displayName || null,
      });
      if (loginMode === "password") setActivePassword(password);
      setPassword("");
      setAccountPassword("");
      toast("登录成功");
    } catch (error) {
      setAdminSession(null);
      setActivePassword("");
      setAdminAuthToken("");
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginLoading(false);
    }
  }

  async function logoutAdmin() {
    const supabase = getSupabaseBrowserAuthClient();
    if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    setAdminSession(null);
    setAdminAuthToken("");
    setActivePassword("");
    setPassword("");
    setAccountPassword("");
  }

  /* ── Login gate ─────────────────────────────────────────── */
  if (!adminSession) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#fbfaf6] via-white to-stone-100 flex items-center justify-center px-4 py-10">
        <section className="w-full max-w-sm rounded-3xl border border-stone-200/80 bg-white p-8 text-center shadow-xl shadow-stone-900/10">
          <div className="mb-6">
            <svg className="mx-auto h-10 w-10 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
          <h1 className="text-xl font-black text-ink">商品管理后台</h1>
          <p className="mt-2 text-sm text-stone-500">Fashion Store Admin</p>
          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            {loginError ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{loginError}</p> : null}
            {initialFeatures.staff_accounts ? <div className="grid grid-cols-2 gap-2 rounded-2xl bg-stone-100 p-1">
              <button className={`rounded-xl px-3 py-2 text-xs font-black ${loginMode === "account" ? "bg-white text-ink shadow-sm" : "text-stone-700"}`} onClick={() => setLoginMode("account")} type="button">员工账号</button>
              <button className={`rounded-xl px-3 py-2 text-xs font-black ${loginMode === "password" ? "bg-white text-ink shadow-sm" : "text-stone-700"}`} onClick={() => setLoginMode("password")} type="button">应急密码</button>
            </div> : <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold leading-5 text-stone-500">当前客户版本未启用员工账号，请使用 owner 应急密码。</p>}
            {initialFeatures.staff_accounts && loginMode === "account" ? (
              <>
                <label className="sr-only" htmlFor="admin-login-email">员工邮箱</label>
                <input aria-label="员工邮箱" autoComplete="username" className="input text-center" id="admin-login-email" onChange={e => setLoginEmail(e.target.value)} type="email" value={loginEmail} placeholder="员工邮箱" />
                <label className="sr-only" htmlFor="admin-account-password">账号密码</label>
                <input aria-label="账号密码" autoComplete="current-password" className="input text-center" id="admin-account-password" onChange={e => setAccountPassword(e.target.value)} type="password" value={accountPassword} placeholder="账号密码" />
              </>
            ) : (
              <><label className="sr-only" htmlFor="admin-emergency-password">管理员应急密码</label><input aria-label="管理员应急密码" autoComplete="current-password" className="input text-center" id="admin-emergency-password" onChange={e => setPassword(e.target.value)} type="password" value={password} placeholder="管理员应急密码" /></>
            )}
            <button className="w-full rounded-full bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50" disabled={loginLoading}>
              {loginLoading ? "登录中..." : "登录"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  /* ── Logged-in UI ────────────────────────────────────────── */
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fbfaf6] via-white to-[#f6f1ea]">
      <div className="mx-auto max-w-[96rem] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* ── Top bar ────────────────────────────────────── */}
        <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-white/95 p-4 shadow-sm shadow-stone-900/5 backdrop-blur sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:rounded-3xl sm:p-5">
          <div>
            <h1 className="text-xl font-black text-ink sm:text-2xl">商品管理后台</h1>
            <p className="hidden text-xs text-stone-400 sm:block">管理商品、图片、尺码库存和实体店日常操作</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600">{adminSession.displayName || adminSession.email || adminSession.role} · {adminSession.authType === "account" ? "员工账号" : "应急密码"}</span>
            {isOwner ? <a className="hidden rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50 xl:inline-flex" href="/admin/settings">店铺设置</a> : null}
            {isOwner && adminFeatures.backup_tools ? <button className="hidden rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50 xl:inline-flex" onClick={() => void downloadProductBackup()} title="仅用于维护数据交换，不是数据库与图片灾备" type="button">维护 CSV 导出</button> : null}
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => void logoutAdmin()} type="button">退出</button>
          </div>
        </header>

        {posRuntimeIssue ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 sm:mb-6" role="alert">
            POS 安全配置未完成：{posRuntimeIssue}
          </div>
        ) : null}

        {featureSettingsFallback ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 sm:mb-6" role="status">
            功能配置尚未完成或暂时无法读取，当前已安全回退到基础版（Basic）；高级功能保持关闭。
          </div>
        ) : null}

        {/* ── Stats cards ────────────────────────────────── */}
        <div className={`${tab === "dashboard" ? "grid" : "hidden"} mb-4 grid-cols-2 gap-2 sm:mb-6 sm:grid-cols-4 sm:gap-3 xl:grid-cols-6`}>
          {[{ label: "商品总数", v: stats.total, color: "bg-stone-500" }, { label: "已上架", v: stats.active, color: "bg-emerald-500" }, { label: "缺图片", v: stats.noImage, color: "bg-amber-400" }, { label: "库存为0", v: stats.noStock, color: "bg-rose-400" }, { label: "未分尺码", v: stats.noSizeStock, color: "bg-violet-400", desktopOnly: true }, { label: "分类数", v: stats.categories, color: "bg-sky-400", desktopOnly: true }].map(s => (
            <div key={s.label} className={`relative overflow-hidden rounded-2xl border border-stone-200/70 bg-white p-3 shadow-sm shadow-stone-900/5 sm:p-4 ${s.desktopOnly ? "hidden xl:block" : "block"}`}>
              <div className={`absolute top-0 left-0 w-1 h-full ${s.color} rounded-l-full`} />
              <p className="text-2xl font-black text-ink">{s.v}</p>
              <p className="mt-0.5 text-[11px] font-bold text-stone-400">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab bar ─────────────────────────────────────── */}
        <nav className="mb-4 sm:mb-6">
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white/95 shadow-sm shadow-stone-900/5">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-3 py-2.5 sm:px-4 sm:py-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Daily workflow</p>
                <p className="mt-0.5 text-sm font-black text-ink">常用操作</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500 md:inline-flex">
                  当前：{tabLabelByKey.get(tab) || tab}
                </span>
                <button
                  data-admin-customize-toggle
                  className={`min-h-9 rounded-xl border px-3 py-2 text-xs font-black transition ${customizingCommonTabs ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"}`}
                  onClick={() => setCustomizingCommonTabs(current => !current)}
                  type="button"
                >
                  {customizingCommonTabs ? "完成" : "自定义"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-5" data-admin-common-tabs>
              {visibleCommonTabKeys.map(key => (
                <button
                  data-admin-tab={key}
                  key={key}
                  className={`${desktopOnlyTabs.has(key) ? "hidden xl:flex" : "flex"} min-h-12 items-center justify-center rounded-xl px-3 py-2.5 text-center text-sm font-black transition sm:min-h-14 sm:px-4 sm:py-3 ${tab === key ? "bg-ink text-white shadow-sm shadow-stone-900/10" : "bg-stone-50 text-ink hover:bg-stone-100"}`}
                  onClick={() => { setTab(key); setCustomizingCommonTabs(false); }}
                  type="button"
                >
                  {tabLabelByKey.get(key) || key}
                </button>
              ))}
            </div>
            {customizingCommonTabs ? (
              <div className="border-t border-stone-100 bg-stone-50/70 p-3 sm:p-4" data-admin-common-customizer>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-ink">调整常用操作</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">使用左右按钮调整顺序；从下方工具中选择“加入常用”。设置只保存在当前电脑或平板浏览器。</p>
                  </div>
                  <button className="min-h-9 w-fit rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-600 hover:bg-stone-100" onClick={resetCommonTabs} type="button">恢复默认</button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {visibleCommonTabKeys.map((key, index) => (
                    <div className={`${desktopOnlyTabs.has(key) ? "hidden xl:block" : "block"} rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5`} key={`${key}-custom`}>
                      <p className="text-sm font-black text-ink">{tabLabelByKey.get(key) || key}</p>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <button aria-label={`将${tabLabelByKey.get(key) || key}向前移动`} className="min-h-9 rounded-lg border border-stone-200 text-sm font-black text-stone-600 disabled:opacity-30" disabled={index === 0} onClick={() => moveCommonTab(key, -1)} type="button">←</button>
                        <button aria-label={`将${tabLabelByKey.get(key) || key}向后移动`} className="min-h-9 rounded-lg border border-stone-200 text-sm font-black text-stone-600 disabled:opacity-30" disabled={index === visibleCommonTabKeys.length - 1} onClick={() => moveCommonTab(key, 1)} type="button">→</button>
                        <button aria-label={`从常用操作移除${tabLabelByKey.get(key) || key}`} className="min-h-9 rounded-lg border border-red-100 text-xs font-black text-red-500 hover:bg-red-50" onClick={() => removeCommonTab(key)} type="button">移除</button>
                      </div>
                    </div>
                  ))}
                </div>
                {visibleAdvancedTabKeys.length > 0 ? (
                  <div className="mt-4 border-t border-stone-200 pt-4">
                    <p className="text-xs font-black text-stone-500">可加入的管理工具</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visibleAdvancedTabKeys.map(key => (
                        <button className={`${desktopOnlyTabs.has(key) ? "hidden xl:inline-flex" : "inline-flex"} min-h-10 items-center rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-600 hover:border-stone-400 hover:text-ink`} data-admin-add-tab={key} key={`${key}-available`} onClick={() => addCommonTab(key)} type="button">＋ {tabLabelByKey.get(key) || key}</button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="border-t border-stone-100 px-3 py-2.5 text-[11px] font-bold leading-5 text-stone-400 xl:hidden">手机 / 平板显示你选择的常用操作；POS 扫码仅在桌面端显示。</p>
            {visibleAdvancedTabKeys.length > 0 ? (
              <details className="hidden border-t border-stone-100 xl:block">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-ink hover:bg-stone-50">
                  <span>更多管理工具</span>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">报表、库存、图片、CSV、Feed 等 · {visibleAdvancedTabKeys.length} 项</span>
                </summary>
                <div className="grid grid-cols-4 gap-2 border-t border-stone-100 p-3 xl:grid-cols-6" data-admin-advanced-tabs>
                  {visibleAdvancedTabKeys.map(key => (
                    <button
                      data-admin-tab={key}
                      key={key}
                      className={`flex min-h-12 items-center justify-center rounded-xl px-3 py-2.5 text-center text-sm font-bold transition ${tab === key ? "bg-ink text-white shadow-sm shadow-stone-900/10" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-ink"}`}
                      onClick={() => { setTab(key); setCustomizingCommonTabs(false); }}
                      type="button"
                    >
                      {tabLabelByKey.get(key) || key}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </nav>

        {/* ── TAB: Stock lookup ─────────────────────────────── */}
        {tab === "stockLookup" ? (
          <section className="admin-panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Fast Stock Lookup</p>
                <h2 className="mt-1 text-xl font-black text-ink">库存快速查询</h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-stone-500">输入商品名、SKU、条码、供货商 SKU 或尺码。扫码枪扫中某个 Variant 后，会自动显示这款商品的全部尺码库存。</p>
              </div>
              <span className="w-fit rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">只读查询，不会修改库存</span>
            </div>

            <form
              className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto]"
              onSubmit={event => {
                event.preventDefault();
                void loadStockLookup();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-stone-500">商品 / 条码</span>
                <input
                  autoComplete="off"
                  className="input min-h-12 text-base"
                  onChange={event => {
                    setStockLookupQuery(event.target.value);
                    setStockLookupError("");
                  }}
                  placeholder="扫码或输入商品名、SKU、供货商 SKU"
                  ref={stockLookupInputRef}
                  value={stockLookupQuery}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-stone-500">尺码（选填）</span>
                <input
                  autoComplete="off"
                  className="input min-h-12 text-base"
                  onChange={event => {
                    setStockLookupSize(event.target.value);
                    setStockLookupError("");
                  }}
                  placeholder="如 M / EU 38"
                  value={stockLookupSize}
                />
              </label>
              <button className="min-h-12 self-end rounded-xl bg-ink px-6 py-3 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={stockLookupLoading} type="submit">
                {stockLookupLoading ? "查询中..." : "查询库存"}
              </button>
              <button
                className="min-h-12 self-end rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink hover:bg-stone-50"
                onClick={() => {
                  setStockLookupQuery("");
                  setStockLookupSize("");
                  setStockLookupItems([]);
                  setStockLookupError("");
                  setStockLookupMessage("");
                  setStockLookupHasSearched(false);
                  window.setTimeout(() => stockLookupInputRef.current?.focus(), 30);
                }}
                type="button"
              >
                清空
              </button>
            </form>

            <p className="mt-3 rounded-xl bg-stone-50 px-4 py-3 text-xs font-bold leading-5 text-stone-500">推荐操作：扫描衣服吊牌 → 查看同款所有尺码 → 确认有货后可带入 POS；最终扣库存前仍会再次校验实时库存。</p>
            {stockLookupError ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{stockLookupError}</p> : null}
            {stockLookupMessage ? <p aria-live="polite" className={`mt-3 rounded-xl border px-4 py-3 text-sm font-bold ${stockLookupItems.length > 0 ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-stone-50 text-stone-600"}`} role="status">{stockLookupMessage}</p> : null}

            {!stockLookupHasSearched ? (
              <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-5 py-10 text-center">
                <p className="text-base font-black text-ink">等待扫码或搜索</p>
                <p className="mt-2 text-sm text-stone-500">蓝牙或 USB 扫码枪通常会像键盘一样输入条码并自动按 Enter。</p>
              </div>
            ) : stockLookupItems.length === 0 && !stockLookupLoading ? (
              <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-5 py-10 text-center text-sm font-bold text-stone-500">未找到库存记录。</div>
            ) : (
              <div className={`mt-5 grid gap-4 ${stockLookupGroups.length > 1 ? "xl:grid-cols-2" : ""}`}>
                {stockLookupGroups.map(group => (
                  <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-900/5" key={group.productId}>
                    <div className="flex gap-3 border-b border-stone-100 p-4">
                      {group.imageUrl ? <img alt="" className="h-24 w-20 shrink-0 rounded-xl object-cover" src={group.imageUrl} /> : <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-[10px] font-bold text-stone-400">暂无图片</div>}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-base font-black text-ink">{group.productName}</p>
                        <p className="mt-1 truncate font-mono text-xs font-bold text-stone-400">{group.productSku}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${group.totalAvailable > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>同款可用 {group.totalAvailable} 件</span>
                          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-600">{group.items.length} 个尺码 / Variant</span>
                        </div>
                      </div>
                    </div>
                    <div className={`grid gap-2 p-3 sm:grid-cols-2 ${stockLookupGroups.length === 1 ? "lg:grid-cols-3 xl:grid-cols-4" : ""}`}>
                      {group.items.map(item => {
                        const threshold = item.reorder_level ?? lowStockThreshold;
                        const unavailable = !item.active || item.quantity_available <= 0;
                        const low = !unavailable && item.quantity_available <= threshold;
                        return (
                          <div className={`rounded-xl border p-3 ${unavailable ? "border-red-100 bg-red-50/50" : low ? "border-amber-100 bg-amber-50/50" : "border-emerald-100 bg-emerald-50/40"}`} key={item.variant_id}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-lg font-black text-ink">{item.size || "ONE SIZE"}</p>
                                <p className="mt-0.5 text-xs font-bold text-stone-500">{item.color || "未设置颜色"}</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-2xl font-black ${unavailable ? "text-red-600" : low ? "text-amber-600" : "text-emerald-700"}`}>{item.quantity_available}</p>
                                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-stone-400">可用库存</p>
                              </div>
                            </div>
                            <div className="mt-2 space-y-0.5 text-[11px] font-bold text-stone-500">
                              <p className="truncate">Variant：{item.variant_sku}</p>
                              {item.barcode ? <p className="truncate">Barcode：{item.barcode}</p> : null}
                              {item.supplier_sku ? <p className="truncate">供货商 SKU：{item.supplier_sku}</p> : null}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${unavailable ? "bg-red-100 text-red-700" : low ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{!item.active ? "已停用" : item.quantity_available <= 0 ? "无货" : low ? "低库存" : "有货"}</span>
                              {canUseTab("pos") ? <button className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-black text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={unavailable} onClick={() => moveStockLookupItemToPos(item)} type="button">带入 POS</button> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* ── TAB: Stock operations ─────────────────────────── */}
        {tab === "stockOperations" ? (
          <section className="admin-panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Stock Operations</p>
                <h2 className="mt-1 text-xl font-black text-ink">扫码库存作业</h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-stone-500">独立处理盘点、到货和可销售退货。不会创建 POS 订单，也不会改动商品资料或真实收银机记录。</p>
              </div>
              <span className="w-fit rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">写入 MAIN_STORE 库存，提交前二次确认</span>
            </div>

            <div className="mt-5 grid gap-2 md:grid-cols-3">
              {stockOperationOptions.map(option => (
                <button
                  className={`rounded-2xl border p-4 text-left transition ${stockOperationMode === option.key ? "border-ink bg-ink text-white shadow-sm shadow-stone-900/10" : "border-stone-200 bg-white text-ink hover:bg-stone-50"}`}
                  key={option.key}
                  onClick={() => {
                    setStockOperationMode(option.key);
                    setStockOperationQuantity(stockOperationItem ? (option.key === "stocktake" ? "" : "1") : "");
                    setStockOperationReference("");
                    setStockOperationError("");
                    setStockOperationMessage("");
                    window.setTimeout(() => (stockOperationItem ? stockOperationQuantityRef : stockOperationInputRef).current?.focus(), 30);
                  }}
                  type="button"
                >
                  <span className="block text-sm font-black">{option.label}</span>
                  <span className={`mt-1 block text-xs leading-5 ${stockOperationMode === option.key ? "text-stone-300" : "text-stone-500"}`}>{option.shortDescription}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold leading-5 text-blue-800">{activeStockOperation.guidance}</p>

            <form
              className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              onSubmit={event => {
                event.preventDefault();
                void searchStockOperationItem();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-stone-500">{stockOperationMode === "receiving" ? "扫描条码，或搜索无条码商品" : "扫描或搜索商品"}</span>
                <input
                  autoComplete="off"
                  className="input min-h-12 text-base"
                  onChange={event => {
                    setStockOperationQuery(event.target.value);
                    setStockOperationError("");
                  }}
                  placeholder={stockOperationMode === "receiving" ? "扫描条码，或输入商品 SKU / 供货商 SKU / 款号 / 商品名" : "扫描条码，或输入 Variant SKU / 供货商 SKU / 商品名"}
                  ref={stockOperationInputRef}
                  value={stockOperationQuery}
                />
              </label>
              <button className="min-h-12 self-end rounded-xl bg-ink px-6 py-3 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={stockOperationLoading || stockOperationSubmitting} type="submit">
                {stockOperationLoading ? "查找中..." : "查找商品"}
              </button>
              <button
                className="min-h-12 self-end rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-black text-ink hover:bg-stone-50"
                onClick={() => {
                  setStockOperationQuery("");
                  setStockOperationResults([]);
                  setStockOperationItem(null);
                  setStockOperationQuantity("");
                  setStockOperationReference("");
                  setStockOperationError("");
                  setStockOperationMessage("");
                  window.setTimeout(() => stockOperationInputRef.current?.focus(), 30);
                }}
                type="button"
              >
                清空
              </button>
            </form>

            {stockOperationError ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{stockOperationError}</p> : null}
            {stockOperationMessage ? <p className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" role="status">{stockOperationMessage}</p> : null}

            {stockOperationItem ? (
              <div className="mt-5 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50/70 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-5">
                <div className="rounded-2xl border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <ProductCardThumb alt={stockOperationItem.product_name || stockOperationItem.product_sku} src={stockOperationProduct?.image_url || ""} />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-base font-black text-ink">{stockOperationItem.product_name || stockOperationItem.product_sku}</p>
                        <p className="mt-1 truncate font-mono text-xs font-bold text-stone-400">{stockOperationItem.variant_sku}</p>
                        {stockOperationItem.supplier_style_code ? <p className="mt-1 truncate text-[11px] font-bold text-stone-500">供货商款号：{stockOperationItem.supplier_style_code}</p> : null}
                      </div>
                    </div>
                    <button className="shrink-0 rounded-lg border border-stone-200 px-3 py-2 text-xs font-black text-stone-600 hover:bg-stone-50" onClick={() => { setStockOperationItem(null); setStockOperationQuantity(""); window.setTimeout(() => stockOperationInputRef.current?.focus(), 30); }} type="button">重选</button>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-stone-50 p-3 text-center">
                    <div><p className="text-xl font-black text-ink">{stockOperationItem.quantity_on_hand}</p><p className="text-[10px] font-black text-stone-400">当前库存</p></div>
                    <div><p className="text-xl font-black text-stone-500">{stockOperationItem.quantity_reserved}</p><p className="text-[10px] font-black text-stone-400">预留</p></div>
                    <div><p className="text-xl font-black text-emerald-700">{stockOperationItem.quantity_available}</p><p className="text-[10px] font-black text-stone-400">可用</p></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-stone-500">
                    <p>尺码：<span className="text-ink">{stockOperationItem.size || "ONE SIZE"}</span></p>
                    <p>颜色：<span className="text-ink">{stockOperationItem.color || "未设置"}</span></p>
                    {stockOperationItem.barcode ? (
                      <p className="col-span-2 truncate">条码：<span className="font-mono text-ink">{stockOperationItem.barcode}</span></p>
                    ) : stockOperationBarcodePlan.action === "generate" ? (
                      <p className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">无 Barcode：确认后先生成 <span className="font-mono">{stockOperationItem.variant_sku}</span>，成功后再入库。</p>
                    ) : stockOperationBarcodePlan.action === "unavailable" ? (
                      <p className="col-span-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">无 Barcode，且当前版本未启用条码与标签打印，自动入库已阻断。</p>
                    ) : <p className="col-span-2 text-stone-400">Barcode：未生成</p>}
                    {stockOperationItem.supplier_sku ? <p className="col-span-2 truncate">供货商 SKU：<span className="font-mono text-ink">{stockOperationItem.supplier_sku}</span></p> : null}
                    {stockOperationItem.supplier_name ? <p className="col-span-2 truncate">供货商：<span className="text-ink">{stockOperationItem.supplier_name}</span></p> : null}
                  </div>
                </div>

                <form className="rounded-2xl border border-stone-200 bg-white p-4" onSubmit={event => { event.preventDefault(); submitStockOperation(); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={activeStockOperation.quantityLabel}>
                      <input
                        className="input min-h-12 text-lg font-black"
                        inputMode="numeric"
                        min={stockOperationMode === "stocktake" ? 0 : 1}
                        onChange={event => { setStockOperationQuantity(event.target.value); setStockOperationError(""); }}
                        placeholder={activeStockOperation.quantityPlaceholder}
                        ref={stockOperationQuantityRef}
                        step="1"
                        type="number"
                        value={stockOperationQuantity}
                      />
                    </Field>
                    <Field label="备注 / 单据号（选填）">
                      <input className="input min-h-12" maxLength={160} onChange={event => setStockOperationReference(event.target.value)} placeholder="例如送货单号、退货单号" value={stockOperationReference} />
                    </Field>
                  </div>
                  <div className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-xs font-bold leading-5 text-stone-500">
                    {stockOperationMode === "stocktake"
                      ? `提交后系统库存会直接改为你填写的实际数量；当前是 ${stockOperationItem.quantity_on_hand}。`
                      : `提交后会在当前库存 ${stockOperationItem.quantity_on_hand} 的基础上增加填写数量。`}
                  </div>
                  <button className="mt-4 min-h-12 w-full rounded-xl bg-ink px-5 py-3 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={stockOperationSubmitting || stockOperationBarcodePlan.action === "unavailable"} type="submit">
                    {stockOperationSubmitting ? "处理中..." : `检查并${activeStockOperation.label}`}
                  </button>
                </form>
              </div>
            ) : stockOperationResults.length > 0 ? (
              <div className="mt-5">
                <p className="mb-2 text-xs font-black text-stone-500">请选择正确尺码 / Variant</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {stockOperationResults.map(item => {
                    const product = productsById.get(item.product_id);
                    return (
                      <button className="rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-stone-400 hover:bg-stone-50" key={item.variant_id} onClick={() => selectStockOperationItem(item)} type="button">
                        <div className="flex items-start gap-3">
                          <ProductCardThumb alt={item.product_name || item.product_sku} src={product?.image_url || ""} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-sm font-black text-ink">{item.product_name || item.product_sku}</p>
                              <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">{item.size || "ONE SIZE"}</span>
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] font-bold text-stone-400">{item.variant_sku}</p>
                            <p className="mt-1 text-xs font-bold text-stone-500">{item.color || "未设置颜色"}</p>
                            {item.supplier_style_code ? <p className="mt-1 truncate text-[11px] font-bold text-stone-500">款号：{item.supplier_style_code}</p> : null}
                            <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${item.barcode ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.barcode ? "已有 Barcode" : stockOperationMode === "receiving" ? "将生成 Barcode" : "无 Barcode"}</span>
                          </div>
                        </div>
                        <p className="mt-3 text-xs font-bold text-stone-500">当前 <span className="text-base font-black text-ink">{item.quantity_on_hand}</span> · 可用 <span className="text-emerald-700">{item.quantity_available}</span></p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-5 py-9 text-center">
                <p className="text-base font-black text-ink">{stockOperationMode === "receiving" ? "等待扫码或搜索同款" : "等待扫码"}</p>
                <p className="mt-2 text-sm text-stone-500">{stockOperationMode === "receiving" ? "有条码直接扫码；没有条码时搜索商品、供货商 SKU 或款号，再选择正确颜色和尺码。" : "扫码枪输入条码并按 Enter 后，系统会选中对应尺码。"}</p>
              </div>
            )}
          </section>
        ) : null}

        {/* ── TAB: Quick add ────────────────────────────────── */}
        {tab === "quickAdd" ? (
          <section className="admin-panel">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-ink">拍照快速上新</h2>
                <p className="mt-1 text-xs text-stone-500">拍主图、填价格和库存，系统自动生成 SKU；适合库存少、款式多的小店。</p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">下一件 SKU：{quickSku()}</span>
            </div>
            <form className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" onSubmit={submitQuickAdd}>
              <div className="order-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3 lg:order-1">
                <Field label="一级分类"><select className="input" data-admin-field="quick-category" value={quickAdd.category} onChange={e => updateQuickAdd("category", e.target.value as ProductCategory)}>{adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" data-admin-field="quick-subcategory" value={quickAdd.subcategory} onChange={e => updateQuickAdd("subcategory", e.target.value)}>{adminSubcategoryOptions(quickAdd.category).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>)}</select></Field>
                <Field label="售价"><input className="input" min="0" step="0.01" type="number" value={quickAdd.price} onChange={e => updateQuickAdd("price", Number(e.target.value))} /></Field>
                <Field label="上架状态"><select className="input" value={quickAdd.is_active ? "yes" : "no"} onChange={e => updateQuickAdd("is_active", e.target.value === "yes")}><option value="yes">保存后上架</option><option value="no">先存草稿</option></select></Field>
                <Field label="尺码体系">
                  <select className="input" value={quickAdd.size_system} onChange={e => updateQuickAdd("size_system", e.target.value as SizeSystem)}>
                    <option value="letter">国际字母尺码 XS–XXXL</option>
                    <option value="eu_women_numeric">欧洲女装 EU 32–54</option>
                    <option value="eu_men_numeric">欧洲男装 EU 42–64</option>
                    <option value="eu_shoes">欧洲鞋码 EU 35–48</option>
                    <option value="one_size">ONE SIZE</option>
                    <option value="custom">自定义尺码</option>
                  </select>
                </Field>
                <Field label="总库存"><div><input className="input bg-stone-50 text-stone-500 cursor-not-allowed" min="0" step="1" type="number" value={stockTotal(quickSizeStock)} readOnly /><p className="mt-1 text-[10px] text-stone-400">由尺码库存自动计算，不能手动填写</p></div></Field>
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="text-sm font-bold text-ink">颜色（选填）× 尺码库存</label>
                  <p className="mt-1 text-xs text-stone-500">先选择尺码并填写数量；单一款式的颜色名称留空。只有同款有多个颜色时才新增颜色组。</p>
                  <div className="mt-2">
                    <ColorSizeInventoryEditor
                      availableSizes={sizeOptionsForSystem(quickAdd.size_system, quickAdd.category)}
                      defaultColor={quickAdd.color}
                      onChange={syncQuickVariantMatrix}
                      onMessage={(message, tone) => toast(message, tone)}
                      oneSize={quickAdd.size_system === "one_size"}
                      rows={quickVariantMatrix}
                    />
                  </div>
                </div>
                <section className="md:col-span-2 xl:col-span-3 rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-900/5">
                  <div className="px-4 py-3 text-sm font-black text-ink">选填商品资料{adminFeatures.ai_tools ? "与 AI 文案" : ""} <span className="ml-2 text-xs font-bold text-stone-400">品牌、名称、描述等</span></div>
                  <div className="grid gap-3 border-t border-stone-100 p-4 md:grid-cols-2">
                    <Field label="品牌（选填）"><input className="input" value={quickAdd.brand} onChange={e => updateQuickAdd("brand", e.target.value)} /></Field>
                    <Field label="中文商品名（选填）"><input className="input" value={quickAdd.name_cn} onChange={e => updateQuickAdd("name_cn", e.target.value)} placeholder="可保存后继续补充" /></Field>
                    <Field label="备注 / 描述（选填）"><textarea className="input min-h-24" value={quickAdd.description_cn} onChange={e => { updateQuickAdd("description_cn", e.target.value); updateQuickAdd("notes", e.target.value); }} placeholder="例如：薄款、适合夏天、宽松版型" /></Field>
                    {adminFeatures.ai_tools ? <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4 shadow-sm shadow-violet-950/5 md:col-span-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-ink">AI 一键生成商品资料</p>
                          <p className="mt-1 text-xs text-stone-500">分类、品牌、颜色及售价由你手动填写；商品仍可上传多张图片，Luna 只读取主图和第一张背面/细节图生成文案，避免浪费 API。</p>
                        </div>
                        <button className="min-h-11 w-full rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-black text-violet-700 shadow-sm shadow-violet-950/5 hover:bg-violet-100 disabled:opacity-50 sm:w-auto sm:text-xs" disabled={aiQuickCopyLoading} onClick={() => void generateQuickProductCopy()} type="button">{aiQuickCopyLoading ? "识别生成中..." : quickMainFile || quickBackFiles.length > 0 ? "AI 识别照片并生成资料" : "AI 生成商品资料"}</button>
                      </div>
                      {quickAdd.name_en || quickAdd.name_gr || quickAdd.description_en || quickAdd.description_gr || quickAdd.material || quickAdd.ai_keywords || quickAdd.style_tags ? (
                        <div className="mt-3 grid gap-2 text-xs text-stone-600 md:grid-cols-2">
                          <p><b>EN:</b> {quickAdd.name_en || "-"} {quickAdd.description_en ? `- ${quickAdd.description_en}` : ""}</p>
                          <p><b>EL:</b> {quickAdd.name_gr || "-"} {quickAdd.description_gr ? `- ${quickAdd.description_gr}` : ""}</p>
                          <p><b>材质/版型:</b> {quickAdd.material || "-"} / {quickAdd.fit_type || "regular"}</p>
                          <p><b>关键词/标签:</b> {quickAdd.ai_keywords || "-"} {quickAdd.style_tags ? ` / ${quickAdd.style_tags}` : ""}</p>
                        </div>
                      ) : null}
                    </div> : null}
                  </div>
                </section>
              </div>
              <div className="order-1 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm shadow-stone-900/5 lg:sticky lg:top-4 lg:order-2 lg:self-start">
                <h3 className="text-sm font-black text-ink">商品照片</h3>
                <p className="mt-1 text-xs text-stone-500">主图必选；背面图、细节图会自动放进多图。</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <label className="block min-h-12 cursor-pointer rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-center text-base font-black text-ink hover:bg-stone-100 sm:text-sm">从相册选择主图<input accept="image/jpeg,image/png,image/webp" className="hidden" type="file" onChange={e => setQuickMainFile(e.target.files?.[0] || null)} /></label>
                  <label className="block min-h-12 cursor-pointer rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-center text-base font-black text-ink hover:bg-stone-100 sm:text-sm">打开相机拍摄<input accept="image/*" capture="environment" className="hidden" type="file" onChange={e => setQuickMainFile(e.target.files?.[0] || null)} /></label>
                </div>
                {quickMainFile ? <p className="mt-2 truncate text-xs text-emerald-700">主图：{quickMainFile.name}</p> : <p className="mt-2 text-xs text-amber-600">还没有主图</p>}
                <label className="mt-3 block min-h-12 cursor-pointer rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-center text-base font-black text-ink hover:bg-stone-100 sm:text-sm">选择背面 / 细节图<input accept="image/*" className="hidden" multiple type="file" onChange={e => setQuickBackFiles(e.target.files ? Array.from(e.target.files) : [])} /></label>
                {quickBackFiles.length > 0 ? <p className="mt-2 text-xs text-stone-500">多图：{quickBackFiles.length} 张</p> : null}
                <button className="mt-5 w-full rounded-full bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50" disabled={quickSaving || loading} type="submit">{quickSaving ? "保存中..." : "保存并上传图片"}</button>
                <p className="mt-3 text-[11px] leading-relaxed text-stone-400">提示：后台会自动生成 SKU；实体店售出后使用“POS 扫码”录入商品并同步库存。</p>
              </div>
            </form>
          </section>
        ) : null}

        {tab === "quickSale" ? (
          <section className="admin-panel">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-ink">快速售出减库存</h2>
                <p className="mt-1 text-xs text-stone-500">实体店卖出一件后，在这里点一下即可减库存；库存归零时会自动下架。</p>
              </div>
              <button className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50" disabled={loading} onClick={() => void loadProducts()} type="button">刷新库存</button>
            </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <input className="input" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="input" data-admin-category-filter value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部一级分类</option>{adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}</select>
              <select className="input" data-admin-subcategory-filter value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat ? adminSubcategoryOptions(filterCat).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>) : null}</select>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {filteredProducts.filter(p => p.is_active && effectiveStock(p) > 0).slice(0, 80).map(product => {
                const raw = product as Record<string, unknown>;
                const stockBySize = raw.size_stock && typeof raw.size_stock === "object" && !Array.isArray(raw.size_stock) ? raw.size_stock as Record<string, number> : null;
                return (
                  <article className="rounded-2xl border border-stone-200/80 bg-white p-3 shadow-sm shadow-stone-900/5" key={product.id}>
                    <div className="flex gap-3">
                      {product.image_url ? <img alt="" className="h-24 w-20 rounded-xl object-cover" src={product.image_url} /> : <div className="h-24 w-20 rounded-xl bg-stone-200" />}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-black leading-snug text-ink">{product.name_cn || product.name_en || product.name_gr || product.sku}</p>
                        <p className="mt-1 truncate text-[11px] font-bold text-stone-400">{product.sku}</p>
                        <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">库存 {effectiveStock(product)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {stockBySize ? sortSizeKeys(Object.keys(stockBySize)).map(size => <button className="min-h-11 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-black text-ink hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40" disabled={(stockBySize[size] || 0) <= 0 || sellingSku === `${product.sku}:${size}`} key={size} onClick={() => void sellOne(product, size)} type="button">{size} -1 <span className="text-stone-400">({stockBySize[size] || 0})</span></button>) : <button className="min-h-11 w-full rounded-xl bg-ink px-4 py-2.5 text-xs font-black text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={sellingSku === `${product.sku}:`} onClick={() => void sellOne(product)} type="button">售出 1 件</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {tab === "pos" ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">POS Checkout</p>
                  <h2 className="mt-1 text-xl font-black text-ink">POS 扫码</h2>
                  <p className="mt-1 text-xs text-stone-500">这是门店扫码枪的主要收银录入界面：扫码商品、计算参考金额并同步库存。当前尚未对接真实 POS 机，实际收款仍需在外部收银机完成。</p>
                </div>
                <button
                  className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50"
                  onClick={() => {
                    setPosQuery("");
                    setPosResults([]);
                    setPosMessage("");
                    window.setTimeout(() => posSearchInputRef.current?.focus(), 30);
                  }}
                  type="button"
                >
                  清空搜索
                </button>
              </div>

              <form
                className="mt-5 flex flex-col gap-3 sm:flex-row"
                onSubmit={e => {
                  e.preventDefault();
                  void searchPosProducts(true);
                }}
              >
                <input
                  ref={posSearchInputRef}
                  className="input min-h-12 flex-1 text-base"
                  placeholder="扫码 / 输入 barcode、variant SKU、商品 SKU 或商品名"
                  value={posQuery}
                  onChange={e => setPosQuery(e.target.value)}
                />
                <button
                  className="min-h-12 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50"
                  disabled={posLoading}
                  type="submit"
                >
                  {posLoading ? "搜索中..." : "搜索并加入"}
                </button>
                <button
                  className="min-h-12 rounded-xl border border-stone-300 px-5 py-3 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50"
                  disabled={posLoading}
                  onClick={() => void searchPosProducts(false)}
                  type="button"
                >
                  只搜索
                </button>
              </form>

              {posMessage ? (
                <p aria-live="polite" className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700" role="status">{posMessage}</p>
              ) : null}

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-black text-ink">搜索结果</h3>
                  <span className="text-xs font-bold text-stone-400">{posResults.length} 个结果</span>
                </div>
                {posResults.length > 0 ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {posResults.map(item => {
                      const disabled = item.outOfStock || item.quantity_available <= 0 || !item.product_active || !item.variant_active;
                      return (
                        <article className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5" key={item.variant_id}>
                          <div className="flex gap-3">
                            {item.image_url ? <img alt="" className="h-24 w-20 rounded-xl object-cover" src={item.image_url} /> : <div className="h-24 w-20 rounded-xl bg-stone-100" />}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-sm font-black leading-snug text-ink">{item.name || item.product_sku}</p>
                              <p className="mt-1 truncate text-[11px] font-bold text-stone-400">{item.product_sku} / {item.variant_sku}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-stone-500">
                                {item.barcode ? <span className="rounded-full bg-stone-100 px-2 py-1">{item.barcode}</span> : null}
                                {item.size ? <span className="rounded-full bg-stone-100 px-2 py-1">{item.size}</span> : null}
                                {item.color ? <span className="rounded-full bg-stone-100 px-2 py-1">{item.color}</span> : null}
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-black text-copper">{formatEuro(item.price)}</span>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                                  可售 {item.quantity_available}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            className="mt-3 min-h-11 w-full rounded-xl bg-ink px-4 py-2.5 text-xs font-black text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
                            disabled={disabled}
                            onClick={() => addPosItem(item)}
                            type="button"
                          >
                            {disabled ? "库存不足 / 已停用" : "加入待扣清单"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-8 text-center text-sm font-bold text-stone-400">
                    输入条码、SKU 或商品名后开始搜索。
                  </div>
                )}
              </div>
            </div>

            <aside className="admin-panel xl:sticky xl:top-4 xl:self-start">
              <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Pending Items</p>
                    <h3 className="mt-1 text-lg font-black text-ink">待扣库存清单</h3>
                </div>
                <button
                  className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50 disabled:opacity-40"
                  disabled={posCart.length === 0 || posCheckoutLoading}
                  onClick={() => {
                    posOperationIds().cancel("checkout");
                    setPosCart([]);
                    setPosPreview(null);
                    setPosLastOrder(null);
                  }}
                  type="button"
                >
                  清空
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {posCart.length > 0 ? posCart.map(item => (
                  <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5" key={item.variant_id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-black text-ink">{item.name || item.product_sku}</p>
                        <p className="mt-1 truncate text-[11px] font-bold text-stone-400">{item.variant_sku}{item.size ? ` / ${item.size}` : ""}{item.color ? ` / ${item.color}` : ""}</p>
                        <p className="mt-1 text-xs font-bold text-stone-500">可售 {item.quantity_available} · {formatEuro(item.price)}</p>
                      </div>
                      <button className="text-xs font-black text-red-500" onClick={() => removePosCartItem(item.variant_id)} type="button">删除</button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button className="h-10 w-10 rounded-xl border border-stone-300 text-sm font-black hover:bg-stone-50" onClick={() => setPosCartQuantity(item.variant_id, item.cartQuantity - 1)} type="button">-</button>
                        <input
                          className="h-10 w-16 rounded-xl border border-stone-300 text-center text-base font-black"
                          min="1"
                          max={item.quantity_available}
                          step="1"
                          type="number"
                          value={item.cartQuantity}
                          onChange={e => setPosCartQuantity(item.variant_id, Number(e.target.value))}
                        />
                        <button className="h-10 w-10 rounded-xl border border-stone-300 text-sm font-black hover:bg-stone-50" onClick={() => setPosCartQuantity(item.variant_id, item.cartQuantity + 1)} type="button">+</button>
                      </div>
                      <p className="text-sm font-black text-ink">{formatEuro(item.price * item.cartQuantity)}</p>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-8 text-center text-sm font-bold text-stone-400">
                    尚未扫描商品。
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                <div className="space-y-2 text-sm font-bold text-stone-600">
                  <div className="flex justify-between"><span>商品小计</span><span>{formatEuro(posSubtotal)}</span></div>
                  <div className="flex items-center justify-between gap-3">
                    <span>线下折扣</span>
                    <input
                      className="h-10 w-28 rounded-xl border border-stone-300 bg-white px-3 text-right text-base font-black sm:text-sm"
                      min="0"
                      step="0.01"
                      type="number"
                      value={posDiscountTotal}
                      onChange={e => {
                        setPosDiscountTotal(e.target.value);
                        setPosPreview(null);
                      }}
                    />
                  </div>
                  <div className="flex justify-between border-t border-stone-200 pt-3 text-lg font-black text-ink"><span>参考合计</span><span>{formatEuro(posTotal)}</span></div>
                </div>

                <div className="mt-4">
                  <p className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-stone-400">收银机付款方式（仅记录）</p>
                  <p className="mb-2 text-[11px] font-bold text-stone-400">不会向银行卡、Viva、Stripe 或其他支付系统发起扣款。</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["cash", "card", "other"] as PosPaymentMethod[]).map(method => (
                      <button
                        className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-black transition ${posPaymentMethod === method ? "border-ink bg-ink text-white" : "border-stone-300 bg-white text-ink hover:bg-stone-50"}`}
                        key={method}
                        onClick={() => setPosPaymentMethod(method)}
                        type="button"
                      >
                        {method === "cash" ? "现金" : method === "card" ? "刷卡" : "其他"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {posPreview ? (
                <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="font-black">预检通过</p>
                  <p className="mt-1 font-bold">后端确认金额：{formatEuro(Number((posPreview as { total?: number }).total ?? posTotal))}</p>
                </div>
              ) : null}

              {posLastOrder?.order ? (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                  {adminFeatures.receipt_printing ? (
                    <button
                      className="mb-3 min-h-10 rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                      disabled={posReceiptLoading}
                      onClick={() => posLastOrder.order?.id ? void openPosReceipt(posLastOrder.order.id) : undefined}
                      type="button"
                    >
                      {posReceiptLoading ? "读取小票..." : "查看 / 打印小票"}
                    </button>
                  ) : null}
                  <p className="font-black">{posLastOrder.alreadyProcessed ? "记录已处理" : "库存扣减完成"}</p>
                  <p className="mt-1 font-bold">订单号：{posLastOrder.order.order_number}</p>
                  <p className="font-bold">金额：{formatEuro(Number(posLastOrder.order.total || 0))}</p>
                  <p className="font-bold">付款：{paymentMethodLabel(posLastOrder.payments?.[0]?.method || posPaymentMethod)}</p>
                  {posLastOrder.legacySyncWarning?.length ? <p className="mt-2 text-xs font-bold text-amber-700">库存兼容字段同步警告：{posLastOrder.legacySyncWarning.join("；")}</p> : null}
                </div>
              ) : null}

              <div className="mt-5 grid gap-2">
                <button
                  className="min-h-12 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50"
                  disabled={posCheckoutLoading || posCart.length === 0}
                  onClick={() => void runPosDryRun(false)}
                  type="button"
                >
                  {posCheckoutLoading ? "处理中..." : "预检实时库存"}
                </button>
                <button
                  className="min-h-12 rounded-xl bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50"
                  disabled={posCheckoutLoading || posCart.length === 0 || Boolean(posRuntimeIssue)}
                  onClick={() => void confirmPosCheckout()}
                  type="button"
                >
                  已在收银机收款，确认扣库存
                </button>
              </div>

              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-700">
                提醒：本系统只保存销售参考记录并扣减 ERP 库存，不处理真实付款，也不能替代实体收银机的正式财务记录。
              </p>
            </aside>
          </section>
        ) : null}

        {tab === "posDaily" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">POS Daily Report</p>
                  <h2 className="mt-1 text-xl font-black text-ink">POS 日报</h2>
                  <p className="mt-1 text-xs text-stone-500">按门店本地日期汇总本系统的扫码扣库存记录、付款方式参考和热销商品。这里只用于库存核对，不替代实体收银机财务报表。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input className="input min-h-11 w-44" type="date" value={posDailyDate} onChange={e => setPosDailyDate(e.target.value)} />
                  <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={posDailyLoading} onClick={() => void loadPosDailyReport()} type="button">
                    {posDailyLoading ? "读取中..." : "刷新日报"}
                  </button>
                </div>
              </div>
              {posDailyMessage ? <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{posDailyMessage}</p> : null}
              {posDailyReport ? (
                <>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                    {[
                      { label: "完成订单", value: posDailyReport.summary.completedOrders },
                      { label: "作废订单", value: posDailyReport.summary.voidedOrders },
                      { label: "售出件数", value: posDailyReport.summary.itemsSold },
                      { label: "销售额", value: formatEuro(posDailyReport.summary.grossSales) },
                      { label: "折扣", value: formatEuro(posDailyReport.summary.discountTotal) },
                      { label: "作废金额", value: formatEuro(posDailyReport.summary.voidedTotal) },
                      { label: "净销售", value: formatEuro(posDailyReport.summary.netSales) },
                    ].map(card => (
                      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm shadow-stone-900/5" key={card.label}>
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-stone-400">{card.label}</p>
                        <p className="mt-2 text-xl font-black text-ink">{card.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <h3 className="text-sm font-black text-ink">付款方式汇总</h3>
                      <div className="mt-3 space-y-2">
                        {posDailyReport.paymentMethods.length > 0 ? posDailyReport.paymentMethods.map(item => (
                          <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm" key={item.method}>
                            <span className="font-bold text-stone-600">{item.method}</span>
                            <span className="font-black text-ink">{formatEuro(item.amount)} · {item.count} 笔</span>
                          </div>
                        )) : <p className="text-sm font-bold text-stone-400">暂无付款记录。</p>}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <h3 className="text-sm font-black text-ink">运行健康</h3>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          ["问题订单", posDailyReport.health.issueOrders],
                          ["缺少明细", posDailyReport.health.missingItems],
                          ["明细金额不一致", posDailyReport.health.itemAmountMismatches],
                          ["付款不一致", posDailyReport.health.paymentMismatches],
                          ["销售流水不一致", posDailyReport.health.saleMovementMismatches],
                          ["作废流水不一致", posDailyReport.health.voidMovementMismatches],
                        ].map(([label, count]) => (
                          <div className={`rounded-xl px-3 py-2 text-sm font-black ${Number(count) === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} key={String(label)}>
                            {label}: {count}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <h3 className="text-sm font-black text-ink">热销商品</h3>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead><tr className="text-xs text-stone-400"><th className="py-2">商品</th><th className="py-2">SKU</th><th className="py-2 text-right">数量</th><th className="py-2 text-right">金额</th></tr></thead>
                          <tbody>
                            {posDailyReport.topItems.map(item => (
                              <tr className="border-t border-stone-100" key={item.variant_sku}>
                                <td className="py-2 font-bold text-ink">{item.name}</td>
                                <td className="py-2 font-mono text-xs text-stone-500">{item.variant_sku || item.product_sku}</td>
                                <td className="py-2 text-right font-black">{item.quantity}</td>
                                <td className="py-2 text-right font-black">{formatEuro(item.total)}</td>
                              </tr>
                            ))}
                            {posDailyReport.topItems.length === 0 ? <tr><td className="py-6 text-center text-stone-400" colSpan={4}>暂无售出商品。</td></tr> : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <h3 className="text-sm font-black text-ink">当日订单</h3>
                      <div className="mt-3 max-h-80 overflow-auto">
                        {posDailyReport.orders.length > 0 ? posDailyReport.orders.map(order => (
                          <div className="mb-2 rounded-xl bg-stone-50 px-3 py-2 text-sm" key={order.id}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-ink">{order.order_number}</span>
                              <span className="font-black text-ink">{formatEuro(order.total)}</span>
                            </div>
                            <div className="mt-1 flex justify-between text-xs font-bold text-stone-500">
                              <span>{formatAdminDate(order.created_at)}</span>
                              <span>{posStatusLabel(order.status)} · {order.items_count} 件</span>
                            </div>
                          </div>
                        )) : <p className="text-sm font-bold text-stone-400">暂无订单。</p>}
                      </div>
                      {posDailyReport.pagination.total > posDailyReport.pagination.limit ? (
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3 text-xs font-bold text-stone-500">
                          <span>
                            {posDailyOffset + 1}–{Math.min(posDailyOffset + posDailyReport.orders.length, posDailyReport.pagination.total)} / {posDailyReport.pagination.total}
                          </span>
                          <div className="flex gap-2">
                            <button
                              className="rounded-lg border border-stone-200 px-3 py-2 disabled:opacity-40"
                              disabled={posDailyLoading || posDailyOffset <= 0}
                              onClick={() => void loadPosDailyReport(Math.max(0, posDailyOffset - posDailyReport.pagination.limit))}
                              type="button"
                            >
                              上一页
                            </button>
                            <button
                              className="rounded-lg border border-stone-200 px-3 py-2 disabled:opacity-40"
                              disabled={posDailyLoading || posDailyOffset + posDailyReport.pagination.limit >= posDailyReport.pagination.total}
                              onClick={() => void loadPosDailyReport(posDailyOffset + posDailyReport.pagination.limit)}
                              type="button"
                            >
                              下一页
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-5 rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">请选择日期并刷新日报。</p>
              )}
            </div>
          </section>
        ) : null}

        {tab === "posOrders" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">POS Orders</p>
                  <h2 className="mt-1 text-xl font-black text-ink">POS 订单历史</h2>
                  <p className="mt-1 text-xs text-stone-500">查看 POS 订单、付款、商品明细和库存流水；有权限的管理员可以作废整单，退款与换货流程暂未开放。</p>
                </div>
                <button
                  className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50"
                  disabled={posOrdersLoading}
                  onClick={() => void loadPosOrders()}
                  type="button"
                >
                  {posOrdersLoading ? "刷新中..." : "刷新订单"}
                </button>
              </div>

              <form
                className="mt-5 grid gap-2 md:grid-cols-5"
                onSubmit={e => {
                  e.preventDefault();
                  void loadPosOrders();
                }}
              >
                <input
                  className="input md:col-span-2"
                  placeholder="搜索订单号 / SKU / 商品名"
                  value={posOrderQ}
                  onChange={e => setPosOrderQ(e.target.value)}
                />
                <select className="input" value={posOrderDateRange} onChange={e => setPosOrderDateRange(e.target.value as PosDateRangeFilter)}>
                  <option value="today">今天</option>
                  <option value="yesterday">昨天</option>
                  <option value="last7days">最近 7 天</option>
                  <option value="all">全部</option>
                </select>
                <select className="input" value={posOrderStatus} onChange={e => setPosOrderStatus(e.target.value as PosOrderStatusFilter)}>
                  <option value="all">全部状态</option>
                  <option value="completed">已完成</option>
                  <option value="voided">已作废</option>
                  <option value="refunded">已退款</option>
                </select>
                <select className="input" value={posOrderPaymentMethod} onChange={e => setPosOrderPaymentMethod(e.target.value as PosPaymentFilter)}>
                  <option value="all">全部付款</option>
                  <option value="cash">现金</option>
                  <option value="card">刷卡</option>
                  <option value="other">其他</option>
                </select>
                <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50 md:col-span-5" disabled={posOrdersLoading} type="submit">
                  查询 POS 订单
                </button>
              </form>

              {posOrdersMessage ? <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700">{posOrdersMessage}</p> : null}

              <div className="mt-5 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
                <table className="min-w-[920px] w-full text-left">
                  <thead className="bg-stone-50 text-xs font-black uppercase tracking-[0.08em] text-stone-500">
                    <tr>
                      <th className="px-4 py-3">订单号</th>
                      <th className="px-4 py-3">时间</th>
                      <th className="px-4 py-3">金额</th>
                      <th className="px-4 py-3">付款</th>
                      <th className="px-4 py-3">支付状态</th>
                      <th className="px-4 py-3">订单状态</th>
                      <th className="px-4 py-3">件数</th>
                      <th className="px-4 py-3">操作人</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-sm">
                    {posOrders.map(order => (
                      <tr className="hover:bg-stone-50/80" key={order.id}>
                        <td className="px-4 py-3 font-black text-ink">{order.order_number}</td>
                        <td className="px-4 py-3 text-xs font-bold text-stone-500">{formatAdminDate(order.created_at)}</td>
                        <td className="px-4 py-3 font-black text-copper">{formatEuro(order.total)}</td>
                        <td className="px-4 py-3 font-bold text-stone-700">{paymentMethodLabel(order.payment_method)}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">{posStatusLabel(order.payment_status)}</span></td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${order.status === "completed" ? "bg-emerald-50 text-emerald-700" : order.status === "voided" ? "bg-stone-100 text-stone-600" : "bg-amber-50 text-amber-700"}`}>{posStatusLabel(order.status)}</span></td>
                        <td className="px-4 py-3 font-bold text-stone-700">{order.items_count}</td>
                        <td className="px-4 py-3 text-xs font-bold text-stone-500">{order.created_by || "-"}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => void loadPosOrderDetail(order.id)} type="button">查看详情</button>
                            {order.status === "completed" && hasPermission("pos:void") ? (
                              <button className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100" onClick={() => openPosVoidDialog(order)} type="button">作废</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {posOrders.length === 0 ? (
                      <tr><td className="px-4 py-8 text-center text-sm font-bold text-stone-400" colSpan={9}>暂无 POS 订单。</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {posOrdersTotal > 100 ? (
                <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-stone-500">
                  <span>{posOrdersOffset + 1}–{Math.min(posOrdersOffset + posOrders.length, posOrdersTotal)} / {posOrdersTotal}</span>
                  <div className="flex gap-2">
                    <button className="rounded-lg border border-stone-200 px-3 py-2 disabled:opacity-40" disabled={posOrdersLoading || posOrdersOffset <= 0} onClick={() => void loadPosOrders(Math.max(0, posOrdersOffset - 100))} type="button">上一页</button>
                    <button className="rounded-lg border border-stone-200 px-3 py-2 disabled:opacity-40" disabled={posOrdersLoading || posOrdersOffset + 100 >= posOrdersTotal} onClick={() => void loadPosOrders(posOrdersOffset + 100)} type="button">下一页</button>
                  </div>
                </div>
              ) : null}
            </div>

            {posOrderDetail ? (
              <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-0 sm:items-center sm:justify-center sm:p-4">
                <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-paper p-5 shadow-2xl sm:max-w-5xl sm:rounded-3xl">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">POS Order Detail</p>
                      <h3 className="mt-1 text-xl font-black text-ink">{posOrderDetail.order.order_number}</h3>
                      <p className="mt-1 text-xs font-bold text-stone-500">{formatAdminDate(posOrderDetail.order.created_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {adminFeatures.pos_void && posOrderDetail.order.status === "completed" && hasPermission("pos:void") ? (
                        <button
                          className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 hover:bg-red-100"
                          onClick={() => openPosVoidDialog(posOrderDetail.order)}
                          type="button"
                        >
                          作废订单
                        </button>
                      ) : null}
                      {adminFeatures.receipt_printing ? (
                        <button
                          className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                          disabled={posReceiptLoading}
                          onClick={() => void openPosReceipt(posOrderDetail.order.id)}
                          type="button"
                        >
                          {posReceiptLoading ? "读取小票..." : "查看 / 打印小票"}
                        </button>
                      ) : null}
                      <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setPosOrderDetail(null)} type="button">关闭</button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">订单状态</p>
                      <p className="mt-1 text-lg font-black text-ink">{posStatusLabel(posOrderDetail.order.status)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">支付状态</p>
                      <p className="mt-1 text-lg font-black text-ink">{posStatusLabel(posOrderDetail.order.payment_status)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">付款方式</p>
                      <p className="mt-1 text-lg font-black text-ink">{paymentMethodLabel(posOrderDetail.payments[0]?.method)}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">总金额</p>
                      <p className="mt-1 text-lg font-black text-copper">{formatEuro(posOrderDetail.order.total)}</p>
                    </div>
                  </div>

                  {posOrderDetail.order.voided_at || posOrderDetail.order.refunded_at ? (
                    <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                      {posOrderDetail.order.voided_at ? `作废时间：${formatAdminDate(posOrderDetail.order.voided_at)}` : ""}
                      {posOrderDetail.order.refunded_at ? `退款时间：${formatAdminDate(posOrderDetail.order.refunded_at)}` : ""}
                    </p>
                  ) : null}

                  <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="rounded-2xl border border-stone-200 bg-white">
                      <div className="border-b border-stone-100 px-4 py-3">
                        <h4 className="text-sm font-black text-ink">商品明细</h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-[720px] w-full text-left text-sm">
                          <thead className="bg-stone-50 text-xs font-black uppercase tracking-[0.08em] text-stone-500">
                            <tr>
                              <th className="px-4 py-3">商品</th>
                              <th className="px-4 py-3">Variant</th>
                              <th className="px-4 py-3">尺码/颜色</th>
                              <th className="px-4 py-3">数量</th>
                              <th className="px-4 py-3">单价</th>
                              <th className="px-4 py-3">小计</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {posOrderDetail.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-3"><p className="font-black text-ink">{item.name}</p><p className="text-xs font-bold text-stone-400">{item.product_sku}</p></td>
                                <td className="px-4 py-3 font-bold text-stone-700">{item.variant_sku}</td>
                                <td className="px-4 py-3 text-stone-600">{item.size || "-"} / {item.color || "-"}</td>
                                <td className="px-4 py-3 font-black text-ink">{item.quantity}</td>
                                <td className="px-4 py-3">{formatEuro(item.unit_price)}</td>
                                <td className="px-4 py-3 font-black text-copper">{formatEuro(item.line_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-stone-200 bg-white p-4">
                        <h4 className="text-sm font-black text-ink">付款信息</h4>
                        <div className="mt-3 space-y-2">
                          {posOrderDetail.payments.map(payment => (
                            <div className="rounded-xl bg-stone-50 p-3 text-sm" key={payment.id}>
                              <p className="font-black text-ink">{payment.method} · {formatEuro(payment.amount)}</p>
                              <p className="mt-1 text-xs font-bold text-stone-500">{payment.status} · {formatAdminDate(payment.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white p-4">
                        <h4 className="text-sm font-black text-ink">库存流水</h4>
                        <div className="mt-3 space-y-2">
                          {posOrderDetail.stock_movements.length > 0 ? posOrderDetail.stock_movements.map(movement => (
                            <div className="rounded-xl bg-stone-50 p-3 text-sm" key={movement.id}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-black text-ink">{movementTypeLabel(movement.movement_type)}</p>
                                <span className={`text-sm font-black ${movement.quantity_delta < 0 ? "text-red-600" : "text-emerald-700"}`}>{signedQuantity(movement.quantity_delta)}</span>
                              </div>
                              <p className="mt-1 text-xs font-bold text-stone-500">{movement.quantity_before} → {movement.quantity_after} · {sourceTypeLabel(movement.source_type)}</p>
                              <p className="mt-1 text-xs text-stone-500">{movement.reason}</p>
                            </div>
                          )) : <p className="rounded-xl bg-stone-50 p-3 text-xs font-bold text-stone-400">没有关联库存流水。</p>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {posOrderDetailLoading ? <p className="mt-4 text-sm font-bold text-stone-500">正在读取详情...</p> : null}
                </div>
              </div>
            ) : null}

            {posVoidDialog ? (
              <div className="fixed inset-0 z-[60] flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
                <div className="w-full rounded-t-3xl bg-paper p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-500">Void POS Order</p>
                  <h3 className="mt-1 text-xl font-black text-ink">作废订单</h3>
                  <p className="mt-2 text-sm font-bold text-stone-600">
                    确认作废 {posVoidDialog.order.order_number}？这会把商品库存加回，并把订单和付款状态标记为作废。
                  </p>
                  <label className="mt-5 block">
                    <span className="text-sm font-black text-ink">作废原因</span>
                    <textarea
                      className="mt-2 min-h-28 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-base font-bold outline-none focus:border-ink sm:text-sm"
                      placeholder="例如：POS 测试订单作废，恢复测试库存"
                      value={posVoidDialog.reason}
                      onChange={e => setPosVoidDialog(current => current ? { ...current, reason: e.target.value, message: "" } : current)}
                    />
                  </label>
                  {posVoidDialog.message ? (
                    <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{posVoidDialog.message}</p>
                  ) : null}
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50"
                      disabled={posVoidDialog.submitting}
                      onClick={cancelPosVoidDialog}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="min-h-11 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50"
                      disabled={posVoidDialog.submitting}
                      onClick={() => void submitPosVoid()}
                      type="button"
                    >
                      {posVoidDialog.submitting ? "作废中..." : "确认作废并加回库存"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "inventory" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">ERP Inventory</p>
                  <h2 className="mt-1 text-xl font-black text-ink">库存管理</h2>
                  <p className="mt-1 text-xs text-stone-500">只管理 ERP 库存记录；前台和已启用的渠道 Feed 仍继续读取兼容库存字段。</p>
                </div>
                <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadInventoryData()} type="button">刷新库存</button>
              </div>
              {inventoryError ? <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{inventoryError}</p> : null}
              <div className={`mt-4 rounded-2xl border px-4 py-3 ${inventoryIssueCount(inventoryReconciliation) === 0 ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-700"}`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-black">{inventoryReconciliation ? inventoryIssueCount(inventoryReconciliation) === 0 ? "ERP 库存对账正常" : `ERP 库存有 ${inventoryIssueCount(inventoryReconciliation)} 个对账问题` : "正在读取 ERP 对账状态"}</p>
                  <button className="rounded-lg border border-current/20 bg-white/70 px-3 py-1.5 text-xs font-black" disabled={inventoryLoading} onClick={() => void loadInventoryReconciliation()} type="button">重新检查</button>
                </div>
                {inventoryReconciliation ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {[
                      ["stock vs balance", inventoryReconciliation.stockVsBalanceMismatches.length],
                      ["size_stock vs ERP", inventoryReconciliation.sizeStockMismatches.length],
                      ["缺 variant", inventoryReconciliation.productsWithoutVariants.length],
                      ["缺 MAIN_STORE", inventoryReconciliation.variantsWithoutMainStoreBalance.length],
                      ["重复 variant SKU", inventoryReconciliation.duplicateVariantSkus.length],
                      ["重复 barcode", inventoryReconciliation.duplicateBarcodes.length],
                      ["预留异常", inventoryReconciliation.reservedExceedsOnHand.length],
                      ["流水原因为空", inventoryReconciliation.blankMovementReasons.length],
                      ["负库存", inventoryReconciliation.negativeBalances.length],
                      ["重复业务 ID", inventoryReconciliation.duplicateOperationKeys.length],
                      ["流水数量计算异常", inventoryReconciliation.movementDeltaMismatches.length],
                      ["流水前后断链", inventoryReconciliation.movementContinuityMismatches.length],
                      ["余额与最新流水不一致", inventoryReconciliation.balanceVsLatestMovementMismatches.length],
                      ["有余额但无流水", inventoryReconciliation.balancesWithoutMovements.length],
                      ["库存操作缺少流水", inventoryReconciliation.operationsMissingMovements.length],
                      ["事务 RPC 未就绪", inventoryReconciliation.runtimeHealth.ready ? 0 : 1],
                    ].map(([label, count]) => (
                      <div className="rounded-xl bg-white/70 px-3 py-2" key={String(label)}>
                        <p className="font-black">{count}</p>
                        <p className="mt-0.5 text-[11px] opacity-75">{label}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {inventoryReconciliation && inventoryIssueCount(inventoryReconciliation) > 0 ? (
                  <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs">
                    <p className="mb-2 font-black">异常样例（只读，不自动修复）</p>
                    {[
                      ["stock vs balance", inventoryReconciliation.stockVsBalanceMismatches],
                      ["size_stock vs ERP", inventoryReconciliation.sizeStockMismatches],
                      ["缺 variant", inventoryReconciliation.productsWithoutVariants],
                      ["缺 MAIN_STORE", inventoryReconciliation.variantsWithoutMainStoreBalance],
                      ["重复 variant SKU", inventoryReconciliation.duplicateVariantSkus],
                      ["重复 barcode", inventoryReconciliation.duplicateBarcodes],
                      ["预留异常", inventoryReconciliation.reservedExceedsOnHand],
                      ["流水原因为空", inventoryReconciliation.blankMovementReasons],
                      ["负库存", inventoryReconciliation.negativeBalances],
                      ["重复业务 ID", inventoryReconciliation.duplicateOperationKeys],
                      ["流水数量计算异常", inventoryReconciliation.movementDeltaMismatches],
                      ["流水前后断链", inventoryReconciliation.movementContinuityMismatches],
                      ["余额与最新流水不一致", inventoryReconciliation.balanceVsLatestMovementMismatches],
                      ["有余额但无流水", inventoryReconciliation.balancesWithoutMovements],
                      ["库存操作缺少流水", inventoryReconciliation.operationsMissingMovements],
                    ].filter(([, rows]) => Array.isArray(rows) && rows.length > 0).slice(0, 4).map(([label, rows]) => (
                      <div className="mt-2" key={String(label)}>
                        <p className="font-bold">{String(label)}：{Array.isArray(rows) ? rows.length : 0} 项</p>
                        <pre className="mt-1 max-h-24 overflow-auto rounded-lg bg-stone-950/5 p-2 text-[11px]">{JSON.stringify(Array.isArray(rows) ? rows.slice(0, 3) : [], null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="admin-panel">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">Inventory Overview</p>
                  <h3 className="mt-1 text-lg font-black text-ink">库存总览</h3>
                  <p className="mt-1 text-xs text-stone-500">优先按一级、二级分类浏览商品库存；关键词和尺码用于进一步缩小范围。</p>
                </div>
                <span className="w-fit rounded-full bg-stone-100 px-3 py-1.5 text-xs font-black text-stone-600">当前结果 {filteredInventoryItems.length} 个规格</span>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7" data-inventory-summary>
                {[
                  { label: "Variant 总数", value: inventorySummary.totalVariants, tone: "text-ink" },
                  { label: "总库存", value: inventorySummary.totalOnHand, tone: "text-ink" },
                  { label: "可用库存", value: inventorySummary.totalAvailable, tone: "text-emerald-700" },
                  { label: "缺货", value: inventorySummary.outOfStock, tone: inventorySummary.outOfStock > 0 ? "text-red-600" : "text-emerald-700" },
                  { label: "低库存", value: inventorySummary.lowStock, tone: inventorySummary.lowStock > 0 ? "text-amber-600" : "text-emerald-700" },
                  { label: "停用", value: inventorySummary.inactive, tone: "text-stone-500" },
                  { label: "对账异常", value: inventorySummary.mismatch, tone: inventorySummary.mismatch > 0 ? "text-red-600" : "text-emerald-700" },
                ].map(item => (
                  <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 text-center" key={item.label}>
                    <p className={`text-xl font-black ${item.tone}`}>{item.value}</p>
                    <p className="mt-1 text-[11px] font-bold text-stone-500">{item.label}</p>
                  </div>
                ))}
              </div>

              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                建议先用测试 SKU 验证库存调整流程，确认流水、对账和前台库存都正常后，再处理真实商品。
              </div>

              <div className="mb-5 rounded-2xl border border-stone-200 bg-stone-50/70 p-4" data-inventory-filter-panel>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
                  <label className="block xl:col-span-3">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">一级分类</span>
                    <select className="input" data-inventory-category value={inventoryCategory} onChange={e => { const nextCategory = e.target.value; setInventoryCategory(nextCategory); setInventorySubcategory(""); void refreshInventoryOverview({ category: nextCategory, subcategory: "" }); }}>
                      <option value="">全部一级分类</option>
                      {adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}
                    </select>
                  </label>
                  <label className="block xl:col-span-3">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">二级分类</span>
                    <select className="input" data-inventory-subcategory disabled={!inventoryCategory} value={inventorySubcategory} onChange={e => { const nextSubcategory = e.target.value; setInventorySubcategory(nextSubcategory); void refreshInventoryOverview({ subcategory: nextSubcategory }); }}>
                      <option value="">全部二级分类</option>
                      {inventoryCategory ? adminSubcategoryOptions(inventoryCategory).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>) : null}
                    </select>
                  </label>
                  <label className="block xl:col-span-4">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">关键词（辅助）</span>
                    <input className="input" data-inventory-search placeholder="商品名 / SKU / barcode / 供货商" value={inventoryQ} onChange={e => setInventoryQ(e.target.value)} />
                  </label>
                  <label className="block xl:col-span-2">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">尺码</span>
                    <input className="input" placeholder="如 S / EU 38" value={inventorySize} onChange={e => setInventorySize(e.target.value)} />
                  </label>
                  <label className="block xl:col-span-3">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">库存状态</span>
                    <select className="input" data-inventory-status value={inventoryStatus} onChange={e => setInventoryStatus(e.target.value as InventoryStatusFilter)}><option value="all">全部状态</option><option value="normal">正常</option><option value="low_stock">低库存</option><option value="out_of_stock">缺货</option><option value="inactive">停用</option><option value="mismatch">对账异常</option></select>
                  </label>
                  <label className="block xl:col-span-3">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">排序</span>
                    <select className="input" value={inventorySort} onChange={e => setInventorySort(e.target.value as InventorySort)}><option value="stock_asc">库存从低到高</option><option value="stock_desc">库存从高到低</option><option value="sku">按 SKU</option></select>
                  </label>
                  <label className="block xl:col-span-3">
                    <span className="mb-1.5 block text-xs font-black text-stone-600">低库存标准</span>
                    <select className="input" value={lowStockThreshold} onChange={e => setLowStockThreshold(Math.max(1, Math.trunc(Number(e.target.value) || 3)))}><option value={1}>可用库存 ≤ 1</option><option value={2}>可用库存 ≤ 2</option><option value={3}>可用库存 ≤ 3</option><option value={5}>可用库存 ≤ 5</option><option value={10}>可用库存 ≤ 10</option></select>
                  </label>
                  <div className="flex items-end xl:col-span-3">
                    <button className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-100" onClick={() => { setInventoryCategory(""); setInventorySubcategory(""); setInventoryQ(""); setInventorySize(""); setInventoryStatus("all"); void refreshInventoryOverview({ category: "", subcategory: "", q: "", size: "" }); }} type="button">清除筛选</button>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button className="min-h-11 rounded-xl bg-ink px-5 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadInventoryData()} type="button">刷新库存数据</button>
                  <button className="min-h-11 rounded-xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-black text-ink hover:bg-stone-50" disabled={filteredInventoryItems.length === 0} onClick={downloadInventoryCsv} type="button">导出当前结果</button>
                </div>
              </div>

              {inventoryLoading ? <p className="mb-3 text-xs font-bold text-stone-400">正在加载库存...</p> : null}
              {filteredInventoryItems.length === 0 && !inventoryLoading ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">暂无库存数据</p> : null}

              <div className="hidden overflow-x-auto rounded-2xl border border-stone-200 xl:block" data-inventory-desktop-table>
                <table className="min-w-[1180px] w-full table-fixed text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-stone-50 text-stone-500">
                    <tr>
                      <th className="w-[17%] px-4 py-3 text-xs font-black">商品</th>
                      <th className="w-[18%] px-4 py-3 text-xs font-black">规格与编码</th>
                      <th className="w-[10%] px-4 py-3 text-xs font-black">条码</th>
                      {canReadProcurement ? <th className="w-[14%] px-4 py-3 text-xs font-black">供货信息</th> : null}
                      {canReadProcurementCost ? <th className="w-[10%] px-4 py-3 text-xs font-black">成本 / 补货</th> : canReadProcurement ? <th className="w-[10%] px-4 py-3 text-xs font-black">补货线</th> : null}
                      <th className="w-[12%] px-4 py-3 text-xs font-black">库存</th>
                      <th className="w-[9%] px-4 py-3 text-xs font-black">状态</th>
                      <th className="w-[10%] px-4 py-3 text-right text-xs font-black">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredInventoryItems.map(item => {
                      const reconciled = item.stock_matches_legacy && item.size_stock_matches_legacy;
                      const stockStatus = inventoryStatusFor(item, lowStockThreshold);
                      return (
                        <tr className="bg-white align-top transition hover:bg-stone-50/70" key={item.variant_id}>
                          <td className="px-4 py-4">
                            <p className="line-clamp-2 font-black text-ink">{item.product_name || "-"}</p>
                            <p className="mt-1 break-all font-mono text-[11px] font-bold text-stone-500">{item.product_sku || "-"}</p>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-1.5 text-[11px] font-black"><span className="rounded-full bg-stone-100 px-2 py-1 text-ink">{item.size || "ONE SIZE"}</span>{item.color ? <span className="rounded-full bg-stone-100 px-2 py-1 text-stone-600">{item.color}</span> : null}</div>
                            <p className="mt-2 break-all font-mono text-[11px] font-bold text-stone-500">{item.variant_sku || "-"}</p>
                          </td>
                          <td className="px-4 py-4"><p className="break-all font-mono text-[11px] font-bold text-stone-600">{item.barcode || "未生成"}</p></td>
                          {canReadProcurement ? (
                            <td className="px-4 py-4 text-xs">
                              <p className="font-black text-ink">{item.supplier_name || "未填写"}</p>
                              {item.supplier_style_code ? <p className="mt-1 font-mono text-[11px] text-stone-500">款号 {item.supplier_style_code}</p> : null}
                              {item.supplier_sku ? <p className="mt-1 break-all font-mono text-[11px] text-stone-500">SKU {item.supplier_sku}</p> : null}
                            </td>
                          ) : null}
                          {canReadProcurement ? (
                            <td className="px-4 py-4 text-xs">
                              {canReadProcurementCost ? <p className="font-black text-ink">{item.cost_price == null ? "未填写" : formatEuro(item.cost_price)}</p> : null}
                              <p className={canReadProcurementCost ? "mt-1 text-stone-400" : "font-black text-ink"}>补货线 ≤ {item.reorder_level ?? lowStockThreshold}</p>
                            </td>
                          ) : null}
                          <td className="px-4 py-4">
                            <div className="grid grid-cols-3 gap-1 text-center">
                              <div><p className="text-sm font-black text-ink">{item.quantity_on_hand}</p><p className="text-[10px] font-bold text-stone-400">现有</p></div>
                              <div><p className="text-sm font-black text-stone-500">{item.quantity_reserved}</p><p className="text-[10px] font-bold text-stone-400">预留</p></div>
                              <div><p className={`text-sm font-black ${item.quantity_available <= 0 ? "text-red-600" : item.quantity_available <= (item.reorder_level ?? lowStockThreshold) ? "text-amber-600" : "text-emerald-700"}`}>{item.quantity_available}</p><p className="text-[10px] font-bold text-stone-400">可用</p></div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black ${stockStatus.className}`}>{stockStatus.label}</span>
                            <span className={`mt-2 inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black ${reconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>对账{reconciled ? "正常" : "异常"}</span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex flex-col items-stretch gap-2">
                              <button className="rounded-lg bg-ink px-3 py-2 text-xs font-black text-white hover:bg-stone-800" onClick={() => openInventoryAdjust(item)} type="button">调整库存</button>
                              <button className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => { setMovementVariantId(item.variant_id); void loadInventoryMovements(item.variant_id); }} type="button">查看流水</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 xl:hidden" data-inventory-mobile-list>
                {filteredInventoryItems.map(item => {
                  const reconciled = item.stock_matches_legacy && item.size_stock_matches_legacy;
                  const stockStatus = inventoryStatusFor(item, lowStockThreshold);
                  return (
                    <article className="rounded-2xl border border-stone-200 bg-white p-4" data-inventory-card={item.variant_id} key={item.variant_id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="line-clamp-2 text-sm font-black text-ink">{item.product_name || "-"}</h4>
                          <p className="mt-1 break-all font-mono text-[11px] font-bold text-stone-500">{item.product_sku}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${stockStatus.className}`}>{stockStatus.label}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        <span className="rounded-full bg-stone-100 px-2.5 py-1.5 text-ink">{item.size || "ONE SIZE"}</span>
                        {item.color ? <span className="rounded-full bg-stone-100 px-2.5 py-1.5 text-stone-600">{item.color}</span> : null}
                        <span className={`rounded-full px-2.5 py-1.5 ${reconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>对账{reconciled ? "正常" : "异常"}</span>
                      </div>
                      <div className="mt-3 rounded-xl bg-stone-50 p-3">
                        <p className="break-all font-mono text-[11px] font-bold text-stone-600">Variant：{item.variant_sku}</p>
                        <p className="mt-1 break-all font-mono text-[11px] text-stone-500">Barcode：{item.barcode || "未生成"}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border border-stone-100 p-2"><p className="text-lg font-black text-ink">{item.quantity_on_hand}</p><p className="text-[10px] font-bold text-stone-400">现有</p></div>
                        <div className="rounded-xl border border-stone-100 p-2"><p className="text-lg font-black text-stone-500">{item.quantity_reserved}</p><p className="text-[10px] font-bold text-stone-400">预留</p></div>
                        <div className="rounded-xl border border-stone-100 p-2"><p className={`text-lg font-black ${item.quantity_available <= 0 ? "text-red-600" : item.quantity_available <= (item.reorder_level ?? lowStockThreshold) ? "text-amber-600" : "text-emerald-700"}`}>{item.quantity_available}</p><p className="text-[10px] font-bold text-stone-400">可用</p></div>
                      </div>
                      {canReadProcurement && (item.supplier_name || item.supplier_sku || item.reorder_level != null) ? (
                        <div className="mt-3 grid gap-1 rounded-xl border border-stone-100 px-3 py-2 text-[11px] text-stone-500 sm:grid-cols-2">
                          <p><span className="font-black text-stone-700">供货：</span>{item.supplier_name || item.supplier_sku || "未填写"}</p>
                          <p>{canReadProcurementCost ? <><span className="font-black text-stone-700">成本：</span>{item.cost_price == null ? "未填写" : formatEuro(item.cost_price)} · </> : null}<span className="font-black text-stone-700">补货线：</span>≤ {item.reorder_level ?? lowStockThreshold}</p>
                        </div>
                      ) : null}
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button className="min-h-11 rounded-xl bg-ink px-3 py-2 text-sm font-black text-white hover:bg-stone-800" onClick={() => openInventoryAdjust(item)} type="button">调整库存</button>
                        <button className="min-h-11 rounded-xl border border-stone-300 px-3 py-2 text-sm font-black text-ink hover:bg-stone-50" onClick={() => { setMovementVariantId(item.variant_id); void loadInventoryMovements(item.variant_id); }} type="button">查看流水</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="admin-panel">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-black text-ink">最近库存流水</h3>
                  <p className="text-xs text-stone-500">{movementVariantId ? "当前只显示所选 variant 的流水。" : `默认显示最近 ${movementLimit} 条库存流水。`}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {movementVariantId ? <button className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => { setMovementVariantId(""); void loadInventoryMovements(""); }} type="button">查看全部流水</button> : null}
                  <button className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => void loadInventoryMovements()} type="button">刷新流水</button>
                </div>
              </div>
              <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_220px_120px_auto]">
                <input className="input" placeholder="搜索 SKU / 商品名 / reason" value={movementQ} onChange={e => setMovementQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadInventoryMovements(); }} />
                <select className="input" value={movementType} onChange={e => setMovementType(e.target.value)}>
                  <option value="">全部类型</option>
                  <option value="initial_migration">initial_migration</option>
                  <option value="sale">sale</option>
                  <option value="manual_adjustment">manual_adjustment</option>
                  <option value="correction">correction</option>
                  <option value="return">return</option>
                  <option value="transfer_in">transfer_in</option>
                </select>
                <select className="input" value={movementSourceType} onChange={e => setMovementSourceType(e.target.value)}>
                  <option value="">全部来源</option>
                  <option value="quick_sell">quick_sell</option>
                  <option value="admin_create">admin_create</option>
                  <option value="admin_edit">admin_edit</option>
                  <option value="csv_import">csv_import</option>
                  <option value="admin_inventory_adjustment">admin_inventory_adjustment</option>
                  <option value="admin_stocktake">admin_stocktake</option>
                  <option value="admin_receiving">admin_receiving</option>
                  <option value="admin_customer_return">admin_customer_return</option>
                </select>
                <select className="input" value={movementLimit} onChange={e => setMovementLimit(Number(e.target.value) || 50)}>
                  <option value={50}>50 条</option>
                  <option value={100}>100 条</option>
                  <option value={200}>200 条</option>
                </select>
                <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800" onClick={() => void loadInventoryMovements()} type="button">筛选流水</button>
              </div>
              {inventoryMovements.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm font-bold text-stone-400">暂无库存流水</p> : (
                <div className="overflow-x-auto rounded-2xl border border-stone-200">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="bg-stone-50 text-stone-500"><tr><th className="px-3 py-2 text-xs font-black">时间</th><th className="px-3 py-2 text-xs font-black">商品</th><th className="px-3 py-2 text-xs font-black">Variant</th><th className="px-3 py-2 text-xs font-black">类型</th><th className="px-3 py-2 text-right text-xs font-black">Before</th><th className="px-3 py-2 text-right text-xs font-black">After</th><th className="px-3 py-2 text-right text-xs font-black">Delta</th><th className="px-3 py-2 text-xs font-black">原因</th><th className="px-3 py-2 text-xs font-black">来源</th></tr></thead>
                    <tbody>
                      {inventoryMovements.map(movement => (
                        <tr className="border-t border-stone-100 bg-white" key={movement.id}>
                          <td className="px-3 py-2 text-xs text-stone-500">{formatAdminDate(movement.created_at)}</td>
                          <td className="px-3 py-2"><p className="line-clamp-1 text-xs font-black text-ink">{movement.product_name || "-"}</p><p className="font-mono text-[11px] text-stone-400">{movement.product_sku || "-"}</p></td>
                          <td className="px-3 py-2 font-mono text-xs font-bold">{movement.variant_sku || "-"}</td>
                          <td className="px-3 py-2">
                            <p className="text-xs font-black text-ink">{movementTypeLabel(movement.movement_type)}</p>
                            <p className="font-mono text-[11px] text-stone-400">{movement.movement_type}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-xs">{movement.quantity_before}</td>
                          <td className="px-3 py-2 text-right text-xs">{movement.quantity_after}</td>
                          <td className={`px-3 py-2 text-right text-xs font-black ${movement.quantity_delta < 0 ? "text-red-600" : "text-emerald-700"}`}>{signedQuantity(movement.quantity_delta)}</td>
                          <td className="max-w-[240px] px-3 py-2 text-xs">{movement.reason || "-"}</td>
                          <td className="px-3 py-2">
                            <p className="text-xs font-bold text-stone-700">{sourceTypeLabel(movement.source_type)}</p>
                            <p className="font-mono text-[11px] text-stone-400">{movement.source_type || "-"}{movement.source_id ? ` / ${movement.source_id}` : ""}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {adjustInventory.item ? (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-3 sm:items-center">
                <div className="w-full max-w-lg rounded-3xl border border-stone-200 bg-white p-5 shadow-2xl shadow-stone-950/20">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-ink">调整库存</h3>
                      <p className="mt-1 text-xs text-stone-500">{adjustInventory.item.product_name || "-"} / {adjustInventory.item.variant_sku}</p>
                    </div>
                    <button className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-black text-stone-500 hover:bg-stone-50" onClick={closeInventoryAdjustment} type="button">关闭</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-50 p-3 text-center">
                    <div><p className="text-lg font-black text-ink">{adjustInventory.item.quantity_on_hand}</p><p className="text-[11px] font-bold text-stone-400">当前</p></div>
                    <div><p className="text-lg font-black text-stone-500">{adjustInventory.item.quantity_reserved}</p><p className="text-[11px] font-bold text-stone-400">预留</p></div>
                    <div><p className="text-lg font-black text-emerald-700">{adjustInventory.item.quantity_available}</p><p className="text-[11px] font-bold text-stone-400">可用</p></div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="调整模式"><select className="input" value={adjustInventory.mode} onChange={e => setAdjustInventory(prev => ({ ...prev, mode: e.target.value as "set_to" | "adjust_by" }))}><option value="set_to">设置为某个数量</option><option value="adjust_by">增加 / 减少数量</option></select></Field>
                    <Field label={adjustInventory.mode === "set_to" ? "目标库存" : "增减数量"}><input className="input" step="1" type="number" value={adjustInventory.quantity} onChange={e => setAdjustInventory(prev => ({ ...prev, quantity: e.target.value, message: "" }))} /></Field>
                    <div className="sm:col-span-2"><Field label="调整原因"><textarea className="input min-h-24" value={adjustInventory.reason} onChange={e => setAdjustInventory(prev => ({ ...prev, reason: e.target.value, message: "" }))} placeholder="例如：盘点修正 / 到货入库修正 / 破损丢失 / 系统同步修正" /></Field></div>
                  </div>
                  {adjustInventory.message ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{adjustInventory.message}</p> : null}
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button className="min-h-11 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50" onClick={closeInventoryAdjustment} type="button">取消</button>
                    <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={adjustInventory.submitting} onClick={submitInventoryAdjustment} type="button">{adjustInventory.submitting ? "提交中..." : "提交调整"}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "check" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-ink">商品上线检查</h2>
                  <p className="mt-1 text-xs text-stone-500">只读检查，不会修改商品。用于判断商品资料、图片、价格和库存是否适合正式展示{adminFeatures.skroutz_feed ? "，并检查 Skroutz Feed" : ""}。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50" disabled={loading} onClick={() => void loadProducts()} type="button">刷新检查</button>
                  {adminFeatures.ai_tools ? <button className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={loading || launchChecks.aiCompletable === 0} onClick={confirmBatchAiComplete} type="button">批量 AI 补全</button> : null}
                  <button className="rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-50" disabled={launchChecks.issueCount === 0} onClick={downloadLaunchCheckReport} type="button">导出检查报告</button>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-7">
                {[
                  { label: "商品总数", value: products.length, tone: "text-ink" },
                  { label: "可前台展示", value: launchChecks.siteReady, tone: "text-emerald-700" },
                  ...(adminFeatures.skroutz_feed ? [{ label: "可进 Skroutz", value: launchChecks.feedReady, tone: "text-blue-700" }] : []),
                  { label: "图片待处理", value: launchChecks.imageIssues, tone: launchChecks.imageIssues > 0 ? "text-amber-600" : "text-emerald-700" },
                  ...(adminFeatures.ai_tools ? [{ label: "可 AI 补全", value: launchChecks.aiCompletable, tone: launchChecks.aiCompletable > 0 ? "text-violet-700" : "text-emerald-700" }] : []),
                  { label: "有阻断问题", value: launchChecks.blockers, tone: launchChecks.blockers > 0 ? "text-red-600" : "text-emerald-700" },
                  { label: "仅需优化", value: launchChecks.warnings, tone: launchChecks.warnings > 0 ? "text-amber-600" : "text-emerald-700" },
                ].map(item => (
                  <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3 text-center sm:p-4" key={item.label}>
                    <p className={`text-xl font-black sm:text-2xl ${item.tone}`}>{item.value}</p>
                    <p className="mt-1 text-xs font-bold text-stone-500">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-panel">
              <h3 className="text-sm font-black text-ink">常见问题快速筛选</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { k: "noimg", l: "缺主图" },
                  { k: "badimage", l: "图片尺寸 / 链接问题" },
                  { k: "nostock", l: "库存为 0" },
                  { k: "nodesc", l: "缺描述" },
                  { k: "nosizestock", l: "缺尺码库存" },
                  { k: "inactive", l: "已下架" },
                  { k: "demo", l: "TEST / DEMO" },
                ].map(button => (
                  <button
                    className="min-h-11 rounded-xl border border-stone-200 px-4 py-2 text-xs font-bold text-ink transition hover:bg-stone-50"
                    key={button.k}
                    onClick={() => { setFilterStatus(button.k); setTab("dashboard"); }}
                    type="button"
                  >
                    {button.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="admin-panel">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-ink">问题商品清单</h3>
                  <p className="mt-1 text-xs text-stone-500">阻断问题会影响正式上架{adminFeatures.skroutz_feed ? "或进入 Feed" : ""}；优化项不会阻断展示，但建议补齐。</p>
                </div>
                <p className="text-xs font-bold text-stone-400">共 {launchChecks.issueCount} 件商品需要处理</p>
              </div>
              <div className="grid gap-3 lg:hidden">
                {launchChecks.rows
                  .filter(row => row.issues.length > 0)
                  .sort((a, b) => b.blockers.length - a.blockers.length || b.warnings.length - a.warnings.length)
                  .slice(0, 120)
                  .map(({ product, issues, blockers, feedReady }) => (
                    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm shadow-stone-900/5" key={product.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-black text-ink">{product.sku || "无 SKU"}</p>
                          <p className="mt-1 line-clamp-2 text-sm font-black text-ink">{product.name_cn || product.name_en || product.name_gr || "未命名商品"}</p>
                          <p className="mt-1 text-[11px] font-bold leading-5 text-stone-400">{categoryPathDisplayLabel(product.category, product.subcategory)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${blockers.length > 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {blockers.length > 0 ? "阻断" : "优化"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {issues.map(issue => (
                          <button className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${issue.level === "block" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`} key={`${product.id}-mobile-${issue.code}`} onClick={() => handleIssueAction(product, issue.code)} type="button">
                            {issue.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <button className="min-h-11 rounded-xl border border-stone-200 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => startEdit(product)} type="button">编辑商品</button>
                        {adminFeatures.ai_tools ? <button className="min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={autoCompletingId === product.id} onClick={() => void startAiComplete(product)} type="button">
                          {autoCompletingId === product.id ? "补全中..." : "AI 补全"}
                        </button> : null}
                        {issues.some(issue => issue.code === "image" || issue.code === "image-quality") ? (
                          <button className="min-h-11 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100" onClick={() => handleIssueAction(product, "image")} type="button">重新上传主图</button>
                        ) : null}
                      </div>
                      {adminFeatures.skroutz_feed ? <p className={`mt-3 text-[11px] font-black ${feedReady ? "text-blue-700" : "text-stone-400"}`}>
                        {feedReady ? "当前会进入 Skroutz Feed" : "当前不会进入 Skroutz Feed"}
                      </p> : null}
                    </article>
                  ))}
                {launchChecks.issueCount === 0 ? <p className="py-8 text-center text-sm font-bold text-emerald-700">当前没有发现上线阻断或明显缺失项。</p> : null}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-stone-50 text-xs font-bold text-stone-400">
                      <th className="py-2.5 pr-3">商品</th>
                      <th className="py-2.5 pr-3">状态</th>
                      <th className="py-2.5 pr-3">问题</th>
                      {adminFeatures.skroutz_feed ? <th className="py-2.5 pr-3">Feed</th> : null}
                      <th className="py-2.5 pr-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {launchChecks.rows
                      .filter(row => row.issues.length > 0)
                      .sort((a, b) => b.blockers.length - a.blockers.length || b.warnings.length - a.warnings.length)
                      .slice(0, 120)
                      .map(({ product, issues, blockers, feedReady }) => (
                        <tr className="border-b border-stone-50 align-top" key={product.id}>
                          <td className="py-3 pr-3">
                            <p className="font-mono text-xs font-black text-ink">{product.sku || "无 SKU"}</p>
                            <p className="mt-1 max-w-64 truncate text-xs font-bold text-stone-600">{product.name_cn || product.name_en || product.name_gr || "未命名商品"}</p>
                            <p className="mt-1 text-[11px] leading-5 text-stone-400">{categoryPathDisplayLabel(product.category, product.subcategory)}</p>
                          </td>
                          <td className="py-3 pr-3">
                            {blockers.length > 0 ? (
                              <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-black text-red-700">阻断</span>
                            ) : (
                              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700">优化</span>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex max-w-xl flex-wrap gap-1.5">
                              {issues.map(issue => (
                                <button className={`rounded-full px-2 py-1 text-[11px] font-bold transition hover:ring-2 hover:ring-stone-200 ${issue.level === "block" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`} key={`${product.id}-${issue.code}`} onClick={() => handleIssueAction(product, issue.code)} title={issue.code === "image" || issue.code === "image-quality" ? "点击去重新上传主图" : "点击定位到对应字段"} type="button">
                                  {issue.label}
                                </button>
                              ))}
                            </div>
                            {issues.some(issue => issue.code === "image" || issue.code === "image-quality") ? (
                              <button className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-800 hover:bg-amber-100" onClick={() => handleIssueAction(product, "image")} type="button">重新上传主图</button>
                            ) : null}
                          </td>
                          {adminFeatures.skroutz_feed ? <td className="py-3 pr-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${feedReady ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-500"}`}>
                              {feedReady ? "会进入" : "不会进入"}
                            </span>
                          </td> : null}
                          <td className="py-3 pr-3">
                            <div className="flex flex-wrap gap-1.5">
                              <button className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => startEdit(product)} type="button">编辑</button>
                              {adminFeatures.ai_tools ? <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={autoCompletingId === product.id} onClick={() => void startAiComplete(product)} type="button">
                                {autoCompletingId === product.id ? "补全中..." : "AI 补全"}
                              </button> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {launchChecks.issueCount === 0 ? <p className="py-10 text-center text-sm font-bold text-emerald-700">当前没有发现上线阻断或明显缺失项。</p> : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* ── TAB: Dashboard ──────────────────────────────── */}
        {tab === "dashboard" ? (
          <section className="admin-panel">
            {/* Health check */}
            <details className="mb-4 hidden group xl:block">
              <summary className="cursor-pointer text-sm font-black text-ink hover:text-stone-600 select-none">商用上线检查</summary>
              <div className="mt-3 grid gap-2 text-xs">
                {(() => { const items: Array<{label:string;ok:boolean;hint:string}> = [
                  { label: "店铺名称", ok: true, hint: "在店铺设置中配置" },
                  { label: "Logo 图片", ok: true, hint: "在店铺设置中上传" },
                  { label: "首页大图", ok: true, hint: "在店铺设置中上传" },
                  { label: "WhatsApp 链接", ok: true, hint: "在店铺设置中填写" },
                  { label: "Instagram 链接", ok: true, hint: "在店铺设置中填写" },
                  { label: "地址", ok: true, hint: "在店铺设置中填写" },
                  { label: "营业时间", ok: true, hint: "在店铺设置中填写" },
                  { label: `上架商品 (${stats.active} 件)`, ok: stats.active >= 4, hint: stats.active >= 4 ? "" : "建议至少 4 件上架商品" },
                  { label: "启用分类", ok: stats.categories > 0, hint: stats.categories > 0 ? "" : "至少需要一个启用的一级分类" },
                  ...(adminFeatures.skroutz_feed ? [{ label: "Skroutz Feed", ok: true, hint: "已按客户版本开启" }] : []),
                ]; return items.map((it, i) => (<div key={i} className="flex items-center gap-2"><span className={it.ok ? "text-green-600" : "text-amber-600"}>{it.ok ? "✓" : "○"}</span><span className="text-stone-600">{it.label}</span>{!it.ok && it.hint ? <span className="text-amber-600">— {it.hint}</span> : null}</div>)); })()}
              </div>
            </details>
            {/* Search bar */}
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <input className="input sm:col-span-2 xl:col-span-2" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="input" data-admin-category-filter value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部一级分类</option>{adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}</select>
              <select className="input" data-admin-subcategory-filter value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat ? adminSubcategoryOptions(filterCat).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>) : null}</select>
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部状态</option><option value="active">已上架</option><option value="inactive">已下架</option><option value="noimg">缺图片</option><option value="badimage">图片尺寸/链接问题</option><option value="nostock">库存为0</option><option value="nosizestock">未分配尺码</option><option value="nodesc">缺描述</option><option value="demo">测试商品</option></select>
            </div>
            {/* Quick filter buttons */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[{k:"noimg",l:"缺图片"},{k:"badimage",l:"图片待处理"},{k:"nosizestock",l:"未分配尺码"},{k:"nostock",l:"库存为0"},{k:"demo",l:"测试商品"}].map(b => (
                <button key={b.k} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filterStatus===b.k ? "bg-ink text-white" : "border border-stone-200 bg-white text-stone-400 hover:border-stone-300 hover:text-ink"}`} onClick={() => setFilterStatus(filterStatus===b.k ? "all" : b.k)} type="button">{b.l}</button>
              ))}
              {filterStatus !== "all" ? <button className="rounded-full px-3.5 py-1.5 text-xs font-bold text-stone-400 hover:text-ink" onClick={() => setFilterStatus("all")} type="button">清除筛选</button> : null}
            </div>

            {/* Batch actions */}
            {selectedIds.size > 0 && isOwner ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-4 py-2 text-sm">
                <span className="text-xs font-bold text-stone-600">已选择 {selectedIds.size} 个商品</span>
                <button className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50" onClick={() => confirmBatch(false)}>批量下架</button>
                <button className="rounded-lg border border-green-100 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-50" onClick={() => confirmBatch(true)}>批量恢复上架</button>
                {adminFeatures.ai_tools ? <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100" onClick={() => batchGenerateAiMeta()} type="button">批量生成 AI 导购</button> : null}
                <button className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-400 hover:bg-stone-100" onClick={() => setSelectedIds(new Set())}>取消选择</button>
              </div>
            ) : null}

            {/* Mobile product cards */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:hidden">
              {filteredProducts.slice(0, Math.min(mobileProductLimit, 100)).map(p => (
                <article className="rounded-2xl border border-stone-200/80 bg-white p-3 shadow-sm shadow-stone-900/5" key={p.id}>
                  <div className="flex gap-3">
                    <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                      {p.image_url ? (
                        <img alt="" className="h-full w-full object-cover" src={p.image_url} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-stone-400">缺图</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-black leading-5 text-ink">{p.name_cn || p.name_en || p.name_gr || p.sku}</p>
                      <p className="mt-1 truncate font-mono text-[11px] font-bold text-stone-400">{p.sku}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-xl bg-stone-100 px-2 py-1 text-[10px] font-bold leading-4 text-stone-500">{categoryPathDisplayLabel(p.category, p.subcategory)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"}`}>{p.is_active ? "上架" : "下架"}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-base font-black text-terracotta">€{Number(p.price).toFixed(2)}</p>
                        <p className="rounded-full bg-stone-50 px-2 py-1 text-[11px] font-bold text-stone-600">库存 {effectiveStock(p)}</p>
                      </div>
                    </div>
                  </div>
                  {isOwner ? <div className="mt-3 grid grid-cols-2 gap-2">
                    <button className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50" onClick={() => startEdit(p)} type="button">编辑</button>
                    {p.is_active ? (
                      <button className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-600 hover:bg-red-100" onClick={() => confirmDeleteProduct(p)} type="button">下架</button>
                    ) : (
                      <button className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs font-black text-green-700 hover:bg-green-100" onClick={() => confirmRestoreProduct(p)} type="button">上架</button>
                    )}
                  </div> : null}
                </article>
              ))}
              {filteredProducts.length === 0 ? <p className="py-10 text-center text-sm text-stone-400 md:col-span-2 lg:col-span-3">没有匹配的商品</p> : null}
              {filteredProducts.length > mobileProductLimit && mobileProductLimit < 100 ? (
                <button
                  className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-black text-ink transition hover:bg-stone-100 md:col-span-2 lg:col-span-3"
                  onClick={() => setMobileProductLimit(current => Math.min(current + 12, 100))}
                  type="button"
                >
                  显示更多商品（剩余 {Math.min(filteredProducts.length, 100) - mobileProductLimit}）
                </button>
              ) : null}
              {filteredProducts.length > 100 && mobileProductLimit >= 100 ? <p className="py-3 text-center text-xs text-stone-400 md:col-span-2 lg:col-span-3">显示前 100 条，使用搜索筛选查看更多</p> : null}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-left">
                <thead><tr className="bg-stone-50/80 text-stone-400">
                  <th className="py-2.5 pr-3 text-xs font-bold w-8"><input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filteredProducts.slice(0, 100).length} onChange={selectAll} /></th>
                  <th className="py-2.5 pr-3 text-xs font-bold w-14">图片</th><th className="py-2.5 pr-3 text-xs font-bold">SKU</th><th className="py-2.5 pr-3 text-xs font-bold">商品名</th><th className="py-2.5 pr-3 text-xs font-bold">分类</th><th className="py-2.5 pr-3 text-xs font-bold">价格</th><th className="py-2.5 pr-3 text-xs font-bold">库存</th><th className="py-2.5 pr-3 text-xs font-bold">状态</th><th className="py-2.5 pr-3 text-xs font-bold w-40">操作</th>
                </tr></thead>
                <tbody>
                  {filteredProducts.slice(0, 100).map(p => (
                    <tr className="border-b border-stone-50 hover:bg-stone-50/70 transition-colors" key={p.id}>
                      <td className="py-2 pr-3 align-middle"><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                      <td className="py-2 pr-3 align-middle">
                        {p.image_url ? (
                          <ImgThumb src={p.image_url} />
                        ) : (
                          <span className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-400">缺图</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs font-bold text-ink">{p.sku}</td>
                      <td className="py-2 pr-3"><p className="text-sm font-bold text-ink line-clamp-1">{p.name_cn || p.name_en || p.name_gr || "—"}</p><p className="text-[11px] text-stone-400 line-clamp-1">{p.name_en}</p></td>
                      <td className="py-2 pr-3"><span className="inline-block max-w-52 whitespace-normal rounded bg-stone-100 px-2 py-1 text-[11px] font-bold leading-4 text-stone-500">{categoryPathDisplayLabel(p.category, p.subcategory)}</span></td>
                      <td className="py-2 pr-3 text-sm font-bold">€{Number(p.price).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-sm">{effectiveStock(p)}</td>
                      <td className="py-2 pr-3"><ProductStatusBadges product={p} showAi={adminFeatures.ai_tools} showSkroutz={adminFeatures.skroutz_feed} /></td>
                      <td className="py-2 pr-3">{isOwner ? <div className="flex gap-1.5">
                        <button className="rounded-md border border-stone-200 px-3 py-1.5 text-xs font-bold whitespace-nowrap hover:bg-stone-100" onClick={() => startEdit(p)}>编辑</button>
                        <button className="rounded-md border border-stone-200 px-3 py-1.5 text-xs font-bold whitespace-nowrap hover:bg-stone-100" onClick={() => copyProduct(p)}>复制</button>
                        {p.is_active ? (
                          <button className="rounded-md border border-red-100 px-3 py-1.5 text-xs font-bold whitespace-nowrap text-red-600 hover:bg-red-50" onClick={() => confirmDeleteProduct(p)}>下架</button>
                        ) : (
                          <>
                            <button className="rounded-md border border-green-100 px-3 py-1.5 text-xs font-bold whitespace-nowrap text-green-700 hover:bg-green-50" onClick={() => confirmRestoreProduct(p)}>恢复上架</button>
                            <button className="rounded-md border border-red-100 px-3 py-1.5 text-xs font-bold whitespace-nowrap text-red-400 hover:bg-red-50" onClick={() => void permanentDelete(p)}>永久删除</button>
                          </>
                        )}
                      </div> : <span className="text-xs font-bold text-stone-400">只读</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 ? <p className="py-12 text-center text-sm text-stone-400">没有匹配的商品</p> : null}
              {filteredProducts.length > 100 ? <p className="py-4 text-center text-xs text-stone-400">显示前 100 条，使用搜索筛选查看更多</p> : null}
            </div>
          </section>
        ) : null}

        {/* ── TAB: Add / Edit ─────────────────────────────── */}
        {tab === "labels" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Barcode Labels</p>
                  <h2 className="mt-1 text-xl font-black text-ink">标签打印</h2>
                  <p className="mt-1 text-xs text-stone-500">新商品保存时会自动生成内部 Barcode；这里主要用于选择规格和打印标签，只有发现历史或异常缺失时才显示补全入口。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadLabelInventoryData()} type="button">刷新</button>
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={visibleLabelItems.length === 0} onClick={selectAllVisibleLabelVariants} type="button">
                    全选当前结果（{visibleLabelItems.length}）
                  </button>
                  <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={selectedLabelItems.length === 0} onClick={openLabelPreview} type="button">打印标签（{selectedLabelCopies} 张）</button>
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={selectedLabelVariantIds.size === 0} onClick={cancelLabelSelection} type="button">取消选择</button>
                </div>
              </div>
              {inventoryError ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{inventoryError}</p> : null}
              {labelMessage ? <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700">{labelMessage}</p> : null}
              {labelSelectionSummary.allMissingBarcodeCount > 0 ? (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between" data-barcode-recovery>
                  <div>
                    <p className="text-sm font-black text-amber-900">条码补全 · 异常处理</p>
                    <p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">
                      发现 {labelSelectionSummary.allMissingBarcodeProductCount} 件商品、{labelSelectionSummary.allMissingBarcodeCount} 个规格缺少 Barcode。这里只补全空值，不会修改已有 Barcode。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="min-h-10 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-100 disabled:opacity-50" disabled={labelSelectionSummary.visibleMissingBarcodeCount === 0} onClick={selectOnlyVisibleMissingBarcodes} type="button">
                      选择当前缺失（{labelSelectionSummary.visibleMissingBarcodeCount}）
                    </button>
                    <button className="min-h-10 rounded-xl bg-amber-900 px-3 py-2 text-xs font-black text-white hover:bg-amber-800 disabled:opacity-50" disabled={selectedMissingBarcodeItems.length === 0 || labelGenerating} onClick={confirmGenerateSelectedBarcodes} type="button">
                      {labelGenerating ? "补全中..." : `补全已选缺失 Barcode（${selectedMissingBarcodeItems.length}）`}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)]">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">查找商品</span>
                  <span className="flex gap-2">
                    <input className="input min-w-0 flex-1" data-label-search placeholder="商品名 / SKU / 条码 / 供货商 SKU" value={labelSearch} onChange={e => setLabelSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); locateLabelProduct(); } }} />
                    <button className="min-h-11 shrink-0 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800" onClick={locateLabelProduct} type="button">查找</button>
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">一级分类</span>
                  <select className="input" data-label-category-filter value={labelCategory} onChange={e => { setLabelCategory(e.target.value); setLabelSubcategory(""); }}>
                    <option value="">全部一级分类</option>
                    {adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">二级分类</span>
                  <select className="input" data-label-subcategory-filter value={labelSubcategory} onChange={e => setLabelSubcategory(e.target.value)}>
                    <option value="">全部二级分类</option>
                    {labelCategory ? adminSubcategoryOptions(labelCategory).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>) : null}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">尺码筛选</span>
                  <select className="input" data-label-size-filter value={labelSizeFilter} onChange={e => setLabelSizeFilter(e.target.value)}>
                    <option value="">全部尺码</option>
                    {labelAvailableSizes.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">库存范围</span>
                  <select className="input" data-label-stock-filter value={labelStockFilter} onChange={e => setLabelStockFilter(e.target.value as LabelStockFilter)}>
                    <option value="all">全部库存</option>
                    <option value="in_stock">只看有库存</option>
                    <option value="out_of_stock">只看无库存</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">标签纸尺寸</span>
                  <select className="input" data-label-paper-size value={labelSize} onChange={e => setLabelSize(e.target.value as LabelSize)}><option value="40x30">40 x 30mm</option><option value="50x30">50 x 30mm</option><option value="60x40">60 x 40mm</option></select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-stone-600">打印语言</span>
                  <select className="input" value={printLanguage} onChange={e => setPrintLanguage(e.target.value as PrintLanguage)}>
                    <option value="el">Ελληνικά</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  {labelSelectionSummary.allMissingBarcodeCount > 0 ? (
                    <label className="flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-xs font-bold text-stone-700">
                      <input checked={labelOnlyMissingBarcode} onChange={e => setLabelOnlyMissingBarcode(e.target.checked)} type="checkbox" />
                      只看无 Barcode
                    </label>
                  ) : null}
                  <label className="flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-xs font-bold text-stone-700">
                    <input checked={labelShowSupplierSku} onChange={e => setLabelShowSupplierSku(e.target.checked)} type="checkbox" />
                    标签显示供货商 SKU
                  </label>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-stone-500">
                <span className="rounded-full bg-stone-100 px-3 py-1.5">当前显示：{labelSelectionSummary.visibleProductCount} 件商品 / {labelSelectionSummary.visibleVariantCount} 个规格</span>
                <span className="rounded-full bg-stone-100 px-3 py-1.5 text-ink">已选择：{labelSelectionSummary.selectedProductCount} 件商品 / {labelSelectionSummary.selectedVariantCount} 个规格</span>
                {labelSelectionSummary.visibleMissingBarcodeCount > 0 ? <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-800">缺少 Barcode：{labelSelectionSummary.visibleMissingBarcodeCount} 个规格</span> : null}
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">已有 Barcode：{labelSelectionSummary.visibleExistingBarcodeCount} 个规格</span>
                {labelSelectionSummary.selectedMissingBarcodeCount > 0 ? <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-800">已选待补全：{labelSelectionSummary.selectedMissingBarcodeCount} / 已有将跳过：{labelSelectionSummary.selectedExistingBarcodeCount}</span> : null}
                <span className="rounded-full bg-stone-900 px-3 py-1.5 text-white">预计打印：{labelSelectionSummary.estimatedPrintCopies} 张</span>
              </div>
            </div>

            <div className="admin-panel">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-lg font-black text-ink">选择商品</h3>
                  <p className="mt-1 text-xs text-stone-500">默认显示全部商品；可使用一级分类、二级分类或搜索缩小范围。</p>
                </div>
                <p className="text-xs font-black text-stone-400">{visibleLabelProductGroups.length} 件商品</p>
              </div>
              {inventoryLoading ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">正在加载标签商品...</p> : null}
              {!inventoryLoading && visibleLabelProductGroups.length === 0 ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">当前筛选条件下没有商品规格</p> : null}
              {!inventoryLoading && visibleLabelProductGroups.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-label-product-grid>
                  {visibleLabelProductGroups.map(group => {
                    const selected = labelProductId === String(group.productId);
                    const selectedCount = group.items.filter(item => selectedLabelVariantIds.has(item.variant_id)).length;
                    const totalStock = group.items.reduce((sum, item) => sum + item.quantity_on_hand, 0);
                    return (
                      <button className={`min-w-0 rounded-2xl border p-3 text-left transition sm:p-4 ${selected ? "border-ink bg-stone-50 shadow-sm" : "border-stone-200 bg-white hover:border-stone-400"}`} data-label-product-card={group.productId} key={group.productId} onClick={() => chooseLabelProduct(String(group.productId))} type="button">
                        <span className="flex min-w-0 gap-3">
                          <ProductCardThumb alt={group.productName} src={group.imageUrl} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0">
                                <span className="block line-clamp-2 text-sm font-black leading-5 text-ink">{group.productName}</span>
                                <span className="mt-1 block truncate font-mono text-[11px] font-bold text-stone-500">{group.productSku}</span>
                              </span>
                              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${totalStock > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>库存 {totalStock}</span>
                            </span>
                            <span className="mt-2 block truncate text-xs font-bold text-stone-500">{group.category ? categoryPathDisplayLabel(group.category, group.subcategory) : "未分类"}</span>
                            <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black">
                              <span className="text-stone-500">{group.items.length} 个尺码 / 规格</span>
                              <span className={selectedCount > 0 ? "text-copper" : "text-ink"}>{selectedCount > 0 ? `已选 ${selectedCount}` : "选择尺码 →"}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {selectedLabelProduct ? (
              <div className="admin-panel scroll-mt-4" data-label-size-panel ref={labelVariantPanelRef}>
                <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-stone-400">当前商品 · 选择尺码</p>
                    <h3 className="mt-1 truncate text-lg font-black text-ink">{selectedLabelProduct.productName}</h3>
                    <p className="mt-1 font-mono text-xs font-bold text-stone-500">{selectedLabelProduct.productSku}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="min-h-10 rounded-xl bg-ink px-3 py-2 text-xs font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={filteredLabelItems.length === 0} onClick={() => updateLabelSelection(filteredLabelItems, true)} type="button">选择当前显示</button>
                    <button className="min-h-10 rounded-xl border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={filteredLabelItems.every(item => item.quantity_on_hand <= 0)} onClick={() => updateLabelSelection(filteredLabelItems.filter(item => item.quantity_on_hand > 0), true)} type="button">选择有库存尺码</button>
                    <button className="min-h-10 rounded-xl border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => updateLabelSelection(selectedLabelProduct.items, false)} type="button">清除此商品已选</button>
                  </div>
                </div>
                {filteredLabelItems.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">当前商品没有符合筛选条件的尺码</p>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-label-variant-grid>
                    {filteredLabelItems.map(item => {
                      const selected = selectedLabelVariantIds.has(item.variant_id);
                      return (
                        <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${selected ? "border-ink bg-stone-50 shadow-sm" : "border-stone-200 bg-white hover:border-stone-400"}`} data-label-variant={item.variant_id} key={item.variant_id}>
                          <input className="mt-1 h-5 w-5 shrink-0 accent-stone-900" checked={selected} onChange={() => toggleLabelVariant(item.variant_id)} type="checkbox" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-lg font-black text-ink">{item.size || "ONE SIZE"}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${item.quantity_on_hand > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>库存 {item.quantity_on_hand}</span>
                            </span>
                            <span className="mt-2 block text-xs font-bold text-stone-600">颜色：{item.color || "未填写"}</span>
                            <span className="mt-1 block break-all font-mono text-[11px] font-bold text-stone-500">{item.variant_sku}</span>
                            <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              {item.barcode ? <span className="break-all font-mono text-[11px] text-stone-500">{item.barcode}</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">barcode 未生成</span>}
                              <span className="text-sm font-black text-copper">{formatEuro(item.price)}</span>
                            </span>
                            <span className="mt-2 block text-[11px] font-bold text-stone-500">选择后默认按当前库存 {Math.max(1, item.quantity_on_hand)} 张加入打印队列。</span>
                            {!item.active ? <span className="mt-2 inline-flex rounded-full bg-stone-100 px-2 py-1 text-[11px] font-black text-stone-500">已停用</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
                  打印前请先用真实标签纸测试。第一版不做 ESC/POS 或打印机 SDK，只使用浏览器打印。
                </p>
              </div>
            ) : null}

            {selectedLabelGroups.length > 0 ? (
              <div className="admin-panel" data-label-print-queue>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-black text-stone-400">PRINT QUEUE</p>
                    <h3 className="mt-1 text-lg font-black text-ink">待打印标签（{selectedLabelCopies} 张）</h3>
                    <p className="mt-1 text-xs text-stone-500">默认按实际库存件数打印；可逐个规格修改数量，最多 500 张。</p>
                  </div>
                  <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800" onClick={openLabelPreview} type="button">预览并打印</button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {selectedLabelGroups.map(group => (
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4" key={group.productId}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-ink">{group.productName}</p>
                          <p className="mt-1 truncate font-mono text-[11px] font-bold text-stone-500">{group.productSku}</p>
                        </div>
                        <button className="shrink-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-black text-stone-600 hover:bg-stone-100" onClick={() => updateLabelSelection(group.items, false)} type="button">移除</button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {group.items.map(item => (
                          <span className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-2 py-1.5" key={item.variant_id}>
                            <button className="text-xs font-black text-ink hover:text-red-600" onClick={() => toggleLabelVariant(item.variant_id)} title="点击移除此尺码" type="button">
                              {item.size || "ONE SIZE"}{item.color ? ` · ${item.color}` : ""} ×
                            </button>
                            <input
                              aria-label={`${item.variant_sku} 打印数量`}
                              className="w-16 rounded-lg border border-stone-200 px-2 py-1 text-center text-sm font-black"
                              max={500}
                              min={1}
                              onChange={event => setLabelCopyCounts(current => ({ ...current, [item.variant_id]: normalizeLabelCopies(event.target.value, item.quantity_on_hand) }))}
                              type="number"
                              value={normalizeLabelCopies(labelCopyCounts[item.variant_id], item.quantity_on_hand)}
                            />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "add" ? (
          <form className="flex flex-col gap-5" onSubmit={submitProduct}>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold leading-5 text-blue-800 xl:hidden">
              手机 / 平板编辑模式只显示基础信息、尺码库存、多语言和图片上传。供货资料、AI 高级字段、欧盟追溯资料和图片 URL 请在桌面端维护。
            </div>
            {/* Basic info card */}
            <section className="admin-panel">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="text-base font-black text-ink">基础信息</h2>
                {adminFeatures.ai_tools ? <p className="text-xs font-bold text-stone-400">AI 补全后需要检查并点击保存才会写入数据库。</p> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="SKU">
                  <div className="flex gap-1.5">
                    <input className="input flex-1" data-admin-field="sku" required value={form.sku} onChange={e => updateField("sku", e.target.value)} />
                    <button className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-[11px] font-bold hover:bg-stone-50 whitespace-nowrap" onClick={generateNextSku} type="button">生成编号</button>
                  </div>
                  <p className="mt-1 text-[10px] text-stone-400">切换分类自动生成前缀: {skuPrefix(form.category, form.subcategory)}001</p>
                </Field>
                <Field label="一级分类"><select className="input" data-admin-field="category" value={form.category} onChange={e => updateField("category", e.target.value as ProductCategory)}>{adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" data-admin-field="subcategory" value={form.subcategory} onChange={e => updateField("subcategory", e.target.value)}>{adminSubcategoryOptions(form.category).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>)}</select></Field>
                <Field label="售价"><input className="input" data-admin-field="price" min="0" step="0.01" type="number" value={form.price} onChange={e => updateField("price", Number(e.target.value))} /></Field>
                <Field label="库存">
                  <div>
                    <input className="input bg-stone-50 text-stone-500 cursor-not-allowed" data-admin-field="stock" min="0" step="1" type="number" value={Object.keys(sizeStock).length > 0 ? stockTotal(sizeStock) : form.stock} readOnly />
                    <p className="mt-1 text-[10px] text-stone-400">由尺码库存自动计算，不能手动填写</p>
                  </div>
                </Field>
                <Field label="尺码">
                  <div>
                    <input className="input bg-stone-50 text-stone-500 cursor-not-allowed" data-admin-field="sizes" value={Object.keys(sizeStock).length > 0 ? sortSizeKeys(Object.keys(sizeStock)).join(",") : form.sizes} readOnly />
                    <p className="mt-1 text-[10px] text-stone-400">由下方尺码库存自动同步</p>
                  </div>
                </Field>
                <Field label="尺码体系">
                  <select className="input" value={form.size_system || inferredSizeSystem(form.category)} onChange={e => updateField("size_system", e.target.value as SizeSystem)}>
                    <option value="letter">国际字母尺码 XS–XXXL</option>
                    <option value="eu_women_numeric">欧洲女装 EU 32–54</option>
                    <option value="eu_men_numeric">欧洲男装 EU 42–64</option>
                    <option value="eu_shoes">欧洲鞋码 EU 35–48</option>
                    <option value="one_size">ONE SIZE</option>
                    <option value="custom">自定义尺码</option>
                  </select>
                  <p className="mt-1 text-[10px] text-stone-400">切换体系不会删除已经填写的尺码和库存。</p>
                </Field>
                <Field label="上架"><select className="input" data-admin-field="is_active" value={form.is_active ? "true" : "false"} onChange={e => updateField("is_active", e.target.value === "true")}><option value="true">是</option><option value="false">否</option></select></Field>
              </div>
            </section>

            {/* Size-Stock card */}
            <section className="admin-panel">
              <h2 className="mb-1 text-base font-black text-ink">颜色（选填）× 尺码库存</h2>
              <p className="mb-3 text-xs text-stone-500">先选择尺码并填写库存；单一款式颜色留空。只有同款存在多个颜色时才添加颜色，每个颜色与尺码组合会生成独立 Variant SKU 和内部 Barcode。</p>
              {editingId && variantMatrix.length === 0 && form.sizes.trim() ? <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">该商品还没有规格库存。旧总库存为 <b>{form.stock}</b>，sizes 为 “{form.sizes}”。请手动分配后保存。</p> : null}
              <ColorSizeInventoryEditor
                availableSizes={sizeOptionsForSystem(form.size_system, form.category)}
                defaultColor={form.color}
                onChange={syncVariantMatrix}
                onMessage={(message, tone) => toast(message, tone)}
                oneSize={form.size_system === "one_size"}
                rows={variantMatrix}
                showProcurement
              />
            </section>

            <details className="admin-panel hidden xl:block">
              <summary className="cursor-pointer list-none text-base font-black text-ink">供货与进货资料（全部选填） <span className="ml-2 text-xs font-bold text-stone-400">点击展开</span></summary>
              <p className="mb-4 mt-2 text-xs text-stone-500">没有供货商 SKU 或成本价可以留空；这些资料仅在后台使用，不会显示给顾客或发送到外部渠道。</p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <Field label="主要供货商">
                  <select className="input" value={form.supplier_id} onChange={e => updateField("supplier_id", e.target.value)}>
                    <option value="">未指定</option>
                    {suppliers.filter(supplier => supplier.active || supplier.id === form.supplier_id).map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
                  </select>
                </Field>
                <Field label="供货商款号"><input className="input" value={form.supplier_style_code} onChange={e => updateField("supplier_style_code", e.target.value)} placeholder="例如 supplier style / model code" /></Field>
                <div className="flex items-end"><button className="admin-button-secondary w-full" onClick={() => setTab("suppliers")} type="button">管理供货商</button></div>
              </div>
            </details>

            {/* i18n card */}
            <section className="admin-panel">
              <h2 className="mb-4 text-base font-black text-ink">多语言内容</h2>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-3"><Field label="中文名"><input className="input" data-admin-field="name_cn" value={form.name_cn} onChange={e => updateField("name_cn", e.target.value)} /></Field><Field label="中文描述"><textarea className="input min-h-24" data-admin-field="description_cn" value={form.description_cn} onChange={e => updateField("description_cn", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="希腊语名"><input className="input" data-admin-field="name_gr" value={form.name_gr} onChange={e => updateField("name_gr", e.target.value)} /></Field><Field label="希腊语描述"><textarea className="input min-h-24" data-admin-field="description_gr" value={form.description_gr} onChange={e => updateField("description_gr", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="英文名"><input className="input" data-admin-field="name_en" value={form.name_en} onChange={e => updateField("name_en", e.target.value)} /></Field><Field label="英文描述"><textarea className="input min-h-24" data-admin-field="description_en" value={form.description_en} onChange={e => updateField("description_en", e.target.value)} /></Field></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {adminFeatures.ai_tools ? <button className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={aiCopyLoading} onClick={() => void generateProductCopy()} type="button">{aiCopyLoading ? "识别生成中..." : newMainFile || newGalleryFiles.length > 0 || editingId && (form.image_url || imageLines(form.image_urls).length > 0) ? "AI 识别照片并生成资料" : "AI 生成商品文案"}</button> : null}
                {adminFeatures.ai_tools ? <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" disabled={translating} onClick={() => void translateProduct()} type="button">{translating ? "翻译中..." : "自动翻译"}</button> : null}
                {editingId ? <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={cancelProductEditor} type="button">取消编辑</button> : null}
              </div>
              {adminFeatures.ai_tools ? <p className="mt-2 text-xs text-stone-500">一级和二级分类、品牌、颜色及售价均由你手动填写；图库可正常上传多张图片，Luna 每次只读取主图和第一张背面/细节图。AI 不会修改这些资料、库存、尺码或条码。</p> : null}
            </section>

            {/* Optional product and AI shopping-assistant data */}
            <details className="admin-panel hidden xl:block">
              <summary className="cursor-pointer list-none text-base font-black text-ink">选填商品资料{adminFeatures.ai_tools ? "与 AI 导购" : ""} <span className="ml-2 text-xs font-bold text-stone-400">点击展开</span></summary>
              <div className="mb-4 mt-3 flex justify-end">
                {adminFeatures.ai_tools ? <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={aiMetaLoading || !form.name_cn.trim() && !form.name_en.trim()} onClick={() => void generateAiMeta()} type="button">{aiMetaLoading ? "生成中..." : "自动生成 AI 导购信息"}</button> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="版型">
                  <select className="input" value={form.fit_type} onChange={e => updateField("fit_type", e.target.value)}>
                    <option value="regular">标准</option>
                    <option value="slim">修身</option>
                    <option value="loose">宽松</option>
                  </select>
                </Field>
                <Field label="材质（需人工确认）">
                  <input className="input" value={form.material} onChange={e => { updateField("material", e.target.value); }} placeholder="100% Cotton" />
                  <p className="mt-1 text-[10px] text-stone-400">材质为选填；如由 AI 生成，请根据商品吊牌或供货信息确认后再保存。</p>
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-ink cursor-pointer"><input type="checkbox" checked={!!((form as Record<string,unknown>).material_verified)} onChange={e => updateField("material_verified" as keyof ProductFormData, e.target.checked as unknown as string)} /> 材质已人工确认</label>
                </Field>
                {adminFeatures.ai_tools ? <Field label="AI关键词（逗号分隔）">
                  <input className="input" value={form.ai_keywords} onChange={e => updateField("ai_keywords", e.target.value)} placeholder="summer, casual, cotton" />
                </Field> : null}
                {adminFeatures.ai_tools ? <Field label="风格标签（逗号分隔）">
                  <input className="input" value={form.style_tags} onChange={e => updateField("style_tags", e.target.value)} placeholder="minimal, greek, mediterranean" />
                </Field> : null}
              </div>
              <div className="mt-3">
                {!showSizeChart ? (
                  <button className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-[11px] font-bold text-stone-400 hover:border-stone-400" onClick={() => setShowSizeChart(true)} type="button">展开高级尺码表（选填）</button>
                ) : (
                  <Field label={`${adminFeatures.ai_tools ? "AI " : ""}尺码表（选填，高级）`}>
                    <div className="flex items-center justify-between mb-2">
                      <button className="text-[11px] font-bold text-stone-400 hover:text-ink" onClick={() => setShowSizeChart(false)} type="button">收起</button>
                      <button className="rounded border border-stone-200 px-2 py-1 text-[10px] font-bold text-stone-500 hover:bg-stone-50" onClick={() => { const examples: Record<string,string> = { tshirts: `{"S":{"bust":"88-92","shoulder":"38-40","length":"66-68","height":"160-170","weight":"45-55"},"M":{"bust":"92-96","shoulder":"40-42","length":"68-70","height":"165-175","weight":"55-65"},"L":{"bust":"96-100","shoulder":"42-44","length":"70-72","height":"170-180","weight":"65-75"},"XL":{"bust":"100-104","shoulder":"44-46","length":"72-74","height":"175-185","weight":"75-85"}}`, shirts: `{"S":{"bust":"92-96","shoulder":"39-41","length":"70-72","height":"160-170"},"M":{"bust":"96-100","shoulder":"41-43","length":"72-74","height":"165-175"},"L":{"bust":"100-104","shoulder":"43-45","length":"74-76","height":"170-180"},"XL":{"bust":"104-108","shoulder":"45-47","length":"76-78","height":"175-185"}}`, dresses: `{"S":{"bust":"84-88","waist":"64-68","hips":"88-92","height":"160-165"},"M":{"bust":"88-92","waist":"68-72","hips":"92-96","height":"165-170"},"L":{"bust":"92-96","waist":"72-76","hips":"96-100","height":"170-175"},"XL":{"bust":"96-100","waist":"76-80","hips":"100-104","height":"175-180"}}`, trousers: `{"S":{"waist":"70-74","hips":"88-92","length":"100-104","weight":"45-55"},"M":{"waist":"74-78","hips":"92-96","length":"102-106","weight":"55-65"},"L":{"waist":"78-82","hips":"96-100","length":"104-108","weight":"65-75"},"XL":{"waist":"82-86","hips":"100-104","length":"106-110","weight":"75-85"}}` }; const cat = ["hoodies","jackets","shirts","tshirts"].includes(form.subcategory) ? "shirts" : ["dresses","skirts","tops"].includes(form.subcategory) ? "dresses" : ["trousers","jeans","shorts"].includes(form.subcategory) ? "trousers" : "tshirts"; updateField("size_chart", examples[cat] || examples.tshirts); }} type="button">插入示例尺码表</button>
                    </div>
                    <textarea className="input min-h-28 font-mono text-[11px]" value={form.size_chart} onChange={e => updateField("size_chart", e.target.value)} placeholder={`{"S":{"bust":"80-84","waist":"62-66","length":"58-60"},"M":{"bust":"84-88","waist":"66-70","length":"60-62"}}`} />
                    <p className="mt-1 text-[10px] text-stone-400">可不填。{adminFeatures.ai_tools ? "填写后 AI 尺码推荐更准确；不填写时只使用基础尺码与版型信息。" : "用于记录更详细的尺码参考。"}</p>
                  </Field>
                )}
              </div>
            </details>

            <details className="admin-panel hidden xl:block">
              <summary className="cursor-pointer list-none text-base font-black text-ink">欧盟服装与追溯资料（全部选填） <span className="ml-2 text-xs font-bold text-stone-400">点击展开</span></summary>
              <p className="mb-4 mt-2 text-xs text-stone-500">只填写吊牌、水洗标或供货商明确提供的资料。没有可靠信息时留空，不影响普通网站上架。</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="纤维成分（希腊语）"><textarea className="input min-h-20" value={form.fiber_composition_gr} onChange={e => updateField("fiber_composition_gr", e.target.value)} placeholder="例如：100% Βαμβάκι" /></Field>
                <Field label="纤维成分（英语）"><textarea className="input min-h-20" value={form.fiber_composition_en} onChange={e => updateField("fiber_composition_en", e.target.value)} placeholder="例如：100% Cotton" /></Field>
                <Field label="护理说明（希腊语）"><textarea className="input min-h-20" value={form.care_instructions_gr} onChange={e => updateField("care_instructions_gr", e.target.value)} /></Field>
                <Field label="护理说明（英语）"><textarea className="input min-h-20" value={form.care_instructions_en} onChange={e => updateField("care_instructions_en", e.target.value)} /></Field>
                <Field label="原产国"><input className="input" value={form.country_of_origin} onChange={e => updateField("country_of_origin", e.target.value)} placeholder="例如 Greece / Italy / China" /></Field>
                <Field label="制造商名称"><input className="input" value={form.manufacturer_name} onChange={e => updateField("manufacturer_name", e.target.value)} /></Field>
                <Field label="制造商联系方式"><input className="input" value={form.manufacturer_contact} onChange={e => updateField("manufacturer_contact", e.target.value)} /></Field>
                <Field label="EU 责任方"><input className="input" value={form.eu_responsible_person} onChange={e => updateField("eu_responsible_person", e.target.value)} /></Field>
                <Field label="安全说明（希腊语）"><textarea className="input min-h-20" value={form.product_safety_notes_gr} onChange={e => updateField("product_safety_notes_gr", e.target.value)} /></Field>
                <Field label="安全说明（英语）"><textarea className="input min-h-20" value={form.product_safety_notes_en} onChange={e => updateField("product_safety_notes_en", e.target.value)} /></Field>
              </div>
            </details>

            {/* Image & links card */}
            <section className="admin-panel">
              <h2 className="mb-4 text-base font-black text-ink"><span className="xl:hidden">商品图片</span><span className="hidden xl:inline">图片与链接</span></h2>

              {/* Inline upload — only when editing */}
              {editingId ? (
                <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="text-sm font-black text-ink">上传图片到当前商品</h3>
                  <p className="mt-1 text-xs text-stone-500">直接上传主图或多图，自动写入商品字段。</p>
                  {adminFeatures.skroutz_feed ? <p className="mt-1 text-[10px] text-amber-700">Skroutz 要求图片至少一边大于 1000px，建议 1200×1200 以上。</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="min-h-11 cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black hover:bg-stone-50">
                      上传主图
                      <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" disabled={loading} onChange={e => { void uploadImages(e.target.files, { sku: form.sku, mode: "main" }); e.currentTarget.value = ""; }} type="file" />
                    </label>
                    <label className="min-h-11 cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black hover:bg-stone-50">
                      上传多图
                      <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" disabled={loading} multiple onChange={e => { void uploadImages(e.target.files, { sku: form.sku, mode: "gallery" }); e.currentTarget.value = ""; }} type="file" />
                    </label>
                  </div>
                  {adminFeatures.ai_tools ? <div className="mt-4 hidden rounded-lg border border-amber-100 bg-amber-50/60 p-3 xl:block">
                    <p className="text-xs font-black text-ink">AI 模特穿搭图（选填）</p>
                    <p className="mt-1 text-[11px] text-stone-500">先上传清晰的真实正面/背面图；系统最多取两张参考图，生成 1024×1536、medium 品质的 WebP 穿搭图，并校验尺寸后加入多图，不会替换主图。</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input className="input bg-white" value={styleImageStyle} onChange={e => setStyleImageStyle(e.target.value)} placeholder="Mediterranean boutique look" />
                      <input className="input bg-white" value={styleImageModelType} onChange={e => setStyleImageModelType(e.target.value)} placeholder="adult fashion model" />
                      <button className="rounded-lg border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50" disabled={loading || styleImageSku === form.sku || !form.image_url} onClick={() => void generateStyleImageForCurrentProduct()} type="button">{styleImageSku === form.sku ? "生成中..." : "生成 AI 模特图"}</button>
                    </div>
                  </div> : null}
                  {/* Image previews */}
                  <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div>
                      <p className="mb-2 text-xs font-bold text-stone-600">主图</p>
                      {form.image_url ? <ImagePreview disabled={loading} url={form.image_url} label="主图" onDel={() => confirmDeleteImage({ sku: form.sku, kind: "main" })} /> : <div className="flex aspect-[4/5] items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-xs text-stone-400">无主图</div>}
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-bold text-stone-600">多图</p>
                      {imageLines(form.image_urls).length > 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{imageLines(form.image_urls).map((u, i) => <ImagePreview key={`${u}-${i}`} disabled={loading} url={u} label={`多图 ${i + 1}`} onDel={() => confirmDeleteImage({ sku: form.sku, kind: "gallery", index: i })} />)}</div> : <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-xs text-stone-400">暂无多图，可上传背面图、细节图</div>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs text-stone-500 mb-2">新商品图片会在保存时自动上传。</p>
                  <div className="flex flex-wrap gap-2">
                    <label className="min-h-11 cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black hover:bg-stone-50">从相册选择主图<input accept="image/jpeg,image/png,image/webp" className="hidden" type="file" onChange={e => setNewMainFile(e.target.files?.[0] || null)} /></label>
                    <label className="min-h-11 cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black hover:bg-stone-50">打开相机拍摄<input accept="image/*" capture="environment" className="hidden" type="file" onChange={e => setNewMainFile(e.target.files?.[0] || null)} /></label>
                    <label className="min-h-11 cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black hover:bg-stone-50">选择多图<input accept="image/*" className="hidden" multiple type="file" onChange={e => setNewGalleryFiles(e.target.files ? Array.from(e.target.files) : [])} /></label>
                    {(newMainFile || newGalleryFiles.length > 0) ? <button className="min-h-11 rounded-xl border border-red-100 px-4 py-2.5 text-sm font-black text-red-500 hover:bg-red-50" onClick={() => { setNewMainFile(null); setNewGalleryFiles([]); }} type="button">清除</button> : null}
                  </div>
                  {newMainFile ? <p className="mt-2 text-xs text-stone-500">主图: {newMainFile.name}</p> : null}
                  {newGalleryFiles.length > 0 ? <p className="mt-1 text-xs text-stone-500">多图: {newGalleryFiles.map(f=>f.name).join(", ")}</p> : null}
                </div>
              )}

              {/* Optional identifiers and URL fields */}
              <div className="rounded-2xl border border-stone-200 bg-white">
                <div className="px-4 py-3 text-sm font-black text-ink">链接、条码与商品标识（选填）</div>
                <div className="grid gap-3 border-t border-stone-100 p-4 md:grid-cols-2 lg:grid-cols-4">
                  <Field label="主图 URL"><input className="input" data-admin-field="image_url" value={form.image_url} onChange={e => updateField("image_url", e.target.value)} /></Field>
                  {adminFeatures.skroutz_feed ? <Field label="Skroutz URL"><input className="input" placeholder="https://www.skroutz.gr/..." value={form.skroutz_url} onChange={e => updateField("skroutz_url", e.target.value)} /></Field> : null}
                  <Field label={adminFeatures.skroutz_feed ? "品牌（一般上架选填；进入 Skroutz 必填）" : "品牌（可选）"}><input className="input" value={form.brand} onChange={e => updateField("brand", e.target.value)} placeholder={adminFeatures.skroutz_feed ? "没有真实品牌则不会进入 Feed" : "如无可留空"} /></Field>
                  <Field label="内部条码（可选）"><input className="input" value={form.barcode} onChange={e => updateField("barcode", e.target.value)} placeholder="门店扫码使用，不自动当作 EAN" /></Field>
                  {adminFeatures.skroutz_feed ? <Field label="真实 EAN（进入 Skroutz 必填）"><input className="input" inputMode="numeric" value={form.ean} onChange={e => updateField("ean", e.target.value)} placeholder="8 或 13 位真实 EAN；缺失时不进入 Feed" /></Field> : null}
                  {adminFeatures.skroutz_feed ? <Field label="制造商 MPN（进入 Skroutz 必填）"><input className="input" value={form.mpn} onChange={e => updateField("mpn", e.target.value)} placeholder="真实制造商编号；缺失时不进入 Feed" /></Field> : null}
                  <Field label="VAT（固定）"><div><input aria-readonly="true" className="input cursor-not-allowed bg-stone-50 text-stone-500" readOnly type="text" value={`${FIXED_PRODUCT_VAT_RATE}%`} /><p className="mt-1 text-[10px] text-stone-400">服装商品固定为 24%，不可调整。</p></div></Field>
                  <div className="md:col-span-2 lg:col-span-4"><Field label="多图 URL（一行一个，可用逗号分隔）"><textarea className="input min-h-24" value={form.image_urls} onChange={e => updateField("image_urls", e.target.value)} /></Field></div>
                </div>
              </div>
            </section>

            {/* Save buttons — sticky at bottom */}
            <div className="admin-sticky-actions">
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
                <button className="admin-button-primary w-full sm:w-auto" disabled={loading} type="submit">{editingId ? "保存修改" : "新增商品"}</button>
                {editingId ? <button className="admin-button-secondary w-full sm:w-auto" onClick={() => { cancelProductEditor(); setTab("dashboard"); }} type="button">取消编辑</button> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {!form.sku.trim() ? <p className="text-xs text-amber-600">请填写 SKU</p> : null}
                {!form.image_url && !newMainFile ? <p className="text-xs text-stone-400">商品暂无图片</p> : null}
                {Object.keys(sizeStock).length === 0 && form.sizes.trim() ? <p className="text-xs text-amber-600">未分配尺码库存</p> : null}
              </div>
            </div>
          </form>
        ) : null}

        {/* ── TAB: CSV ────────────────────────────────────── */}
        {tab === "csv" ? (
          <section className="admin-panel">
            <h2 className="mb-1 text-lg font-black text-ink">CSV 批量导入</h2>
            <p className="mb-4 text-xs text-stone-500">先由服务器校验整份文件，再创建可恢复的导入 Job。导入模式、库存模式和自动翻译都需要明确选择，不再隐式覆盖商品或库存。</p>

            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <label className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                <span className="block text-sm font-black text-ink">商品处理模式</span>
                <select
                  className="input mt-2 bg-white"
                  disabled={csvHasPendingOperation || csvBusy !== null}
                  onChange={event => void changeCsvModes(event.target.value as ProductCsvImportMode, csvInventoryMode)}
                  value={csvImportMode}
                >
                  <option value="create_only">仅新增：已存在 SKU 记为失败</option>
                  <option value="update_existing">仅更新：不存在 SKU 记为失败</option>
                  <option value="upsert">新增或更新：按 SKU 自动判断</option>
                </select>
                <span className="mt-2 block text-[11px] leading-relaxed text-stone-500">日常新增优先使用“仅新增”，可以避免误覆盖已有商品。</span>
              </label>
              <label className={`rounded-2xl border p-3 ${csvInventoryMode === "set_inventory" ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-stone-50/70"}`}>
                <span className="block text-sm font-black text-ink">库存处理模式</span>
                <select
                  className="input mt-2 bg-white"
                  disabled={csvHasPendingOperation || csvBusy !== null}
                  onChange={event => void changeCsvModes(csvImportMode, event.target.value as ProductCsvInventoryMode)}
                  value={csvInventoryMode}
                >
                  <option value="metadata_only">只导入商品资料，不修改库存</option>
                  <option value="set_inventory">按 CSV 设置库存（会产生库存流水）</option>
                </select>
                <span className="mt-2 block text-[11px] leading-relaxed text-stone-500">库存不确定时保持“只导入商品资料”；设置库存前请确认尺码和数量完整。</span>
              </label>
            </div>

            <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black hover:bg-stone-50" onClick={downloadQuickCsvTemplate} type="button">下载快速 CSV 模板</button>
              <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black hover:bg-stone-50" onClick={downloadCsvTemplate} type="button">下载完整 CSV 模板</button>
              {adminFeatures.ai_tools ? <button className="min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={!csvPreview || csvPreview.previewTruncated || csvSummary.needsTranslation === 0 || csvBusy !== null || csvHasPendingOperation} onClick={() => void translateCsvPreview()} type="button">{csvBusy === "translate" ? "翻译中..." : "可选：补充英/希译文"}</button> : null}
              <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={!csvFile || !csvPreview || csvBusy !== null || csvHasPendingOperation} onClick={confirmImportCsv} type="button">{csvBusy === "submit" ? "正在创建 Job..." : "创建导入 Job"}</button>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
              <label className="block text-sm font-black text-ink">选择 CSV 文件</label>
              <input ref={csvFileInputRef} accept=".csv,text/csv" className="input mt-2 min-h-12 bg-white" disabled={csvHasPendingOperation || csvBusy !== null && csvBusy !== "preview"} onChange={e => void handleCsv(e.target.files?.[0] || null)} type="file" />
              {csvBusy === "preview" ? <p className="mt-2 text-xs font-bold text-blue-700">服务器正在解析和校验整份文件...</p> : null}
            </div>
            <p className="mt-2 text-xs text-stone-500">快速模板只保留日常上新字段，图片 URL 可以留空，之后用批量上传按 SKU 自动绑定；完整模板适合从备份迁移或填写 AI / 尺码表等高级字段。模板示例包含尺码库存，使用示例时请选择“按 CSV 设置库存”；只导资料时请清空 stock 和 size_stock。</p>
            <p className="mt-2 text-xs text-stone-400">字段：{csvFields.join(", ")}</p>
            {csvPreviewError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-relaxed text-red-700">{csvPreviewError}{csvFile && !csvPreview && !csvHasPendingOperation ? <button className="ml-2 underline underline-offset-4 disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void previewCsvFile(csvFile)} type="button">重新预览</button> : null}</div> : null}
            {csvHasPendingOperation && !csvJobView ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-black text-amber-900">存在结果待确认的 CSV 业务 ID</p><p className="mt-1 text-xs text-amber-800">请恢复原 Job；不要换文件或生成新的业务 ID。</p></div>
                <button className="min-h-11 rounded-xl bg-amber-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void recoverPendingCsvImport(true)} type="button">{csvBusy === "recover" ? "恢复中..." : "恢复 Job 状态"}</button>
              </div>
            ) : null}

            {csvPreview ? (
              <div className="mt-4">
                <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5">
                  <p className="text-sm font-black text-ink">服务器预览通过：{csvSummary.valid} 行{csvSummary.needsTranslation > 0 ? `，其中 ${csvSummary.needsTranslation} 行可选补充译文` : ""}</p>
                  <p className="mt-1 text-xs text-stone-500">{csvPreview.filename} · {(csvPreview.byteLength / 1024).toFixed(1)} KB · {csvImportModeLabels[csvPreview.importMode]} · {csvInventoryModeLabels[csvPreview.inventoryMode]}</p>
                  {csvPreview.previewTruncated ? <p className="mt-2 text-xs font-bold text-amber-700">页面只展示前 100 行，服务器已校验全部 {csvPreview.rowCount} 行；大文件不提供自动翻译，避免只翻译部分数据。</p> : null}
                  {csvTranslations.length > 0 ? <p className="mt-2 text-xs font-bold text-violet-700">翻译成功 {csvTranslations.filter(result => result.translated).length} 行，失败 {csvTranslationFailures} 行；失败行保持 CSV 原值。</p> : null}
                </div>
                <ResultTable results={csvPreviewResults} />
              </div>
            ) : null}

            {csvJobView ? (
              <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-ink">CSV Job · {csvJobStatusLabels[csvJobView.job.status]}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-stone-500">{csvJobView.job.id}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-72">
                    <div className="rounded-xl bg-white p-2"><strong className="block text-base text-green-700">{csvJobView.job.succeeded_rows}</strong>成功</div>
                    <div className="rounded-xl bg-white p-2"><strong className="block text-base text-red-600">{csvJobView.job.failed_rows}</strong>失败</div>
                    <div className="rounded-xl bg-white p-2"><strong className="block text-base text-amber-700">{csvJobView.job.pending_rows}</strong>待处理</div>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200"><div className="h-full bg-green-600 transition-all" style={{ width: `${Math.round(((csvJobView.job.succeeded_rows + csvJobView.job.failed_rows) / Math.max(csvJobView.job.total_rows, 1)) * 100)}%` }} /></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {csvJobView.job.pending_rows > 0 ? <button className="min-h-11 rounded-xl bg-ink px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void processCsvJob("process")} type="button">{csvBusy === "process" ? "处理中..." : "继续下一批"}</button> : null}
                  {csvJobView.job.failed_rows > 0 ? <button className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800 disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void processCsvJob("retry")} type="button">{csvBusy === "retry" ? "重试中..." : `重试失败行${csvRetryableFailures > 0 ? `（当前页 ${csvRetryableFailures}）` : ""}`}</button> : null}
                  <button className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-black disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void processCsvJob("refresh")} type="button">刷新状态</button>
                  {csvJobView.job.failed_rows > 0 ? <button className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-black disabled:opacity-50" disabled={csvBusy !== null} onClick={() => void downloadCsvErrors()} type="button">下载失败 CSV</button> : null}
                </div>
                {csvJobView.job.pending_rows === 0 && csvJobView.job.failed_rows > 0 ? <button className="mt-3 text-xs font-bold text-stone-500 underline decoration-dotted underline-offset-4" onClick={finishReviewedCsvJob} type="button">已核对失败行，结束此 Job 并开始新文件</button> : null}
                <ResultTable results={csvJobResults} />
                {csvJobView.totalRows > csvJobView.rows.length ? <p className="mt-2 text-xs text-stone-500">当前显示前 {csvJobView.rows.length} 行 Job 明细，共 {csvJobView.totalRows} 行。</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── TAB: Bulk Images ──────────────────────────────── */}
        {tab === "images" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <h2 className="mb-1 text-lg font-black text-ink">选择商品上传</h2>
              <p className="mb-3 text-xs text-stone-500">用分类和搜索筛选商品，再上传主图或多图。{adminFeatures.skroutz_feed ? "Skroutz 要求图片最长边大于 1000px，建议 1200-1600px。" : "建议使用清晰、比例一致的商品图片。"}</p>
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <input className="input" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" data-admin-category-filter value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部一级分类</option>{adminCategoryOptions.map(category => <option key={String(category.slug)} value={String(category.slug)}>{categoryOptionLabel(category)}</option>)}</select>
                <select className="input" data-admin-subcategory-filter value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat ? adminSubcategoryOptions(filterCat).map(subcategory => <option key={String(subcategory.slug)} value={String(subcategory.slug)}>{subcategoryOptionLabel(subcategory)}</option>) : null}</select>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block rounded-2xl border border-stone-200 bg-stone-50/70 p-3"><span className="text-sm font-bold text-ink">商品</span><select className="input mt-2" value={selectedImageSku} onChange={e => setSelectedImageSku(e.target.value)}><option value="">选择商品 SKU</option>{filteredProducts.map(p => <option key={p.id} value={p.sku}>{p.sku} - {p.name_cn || p.name_gr || p.name_en || "未命名"} - {categoryPathDisplayLabel(p.category, p.subcategory)}</option>)}</select></label>
                <label className="block rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5"><span className="text-sm font-black text-ink">上传主图</span><span className="mt-1 block text-[11px] font-bold text-stone-400">会替换当前主图</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2 min-h-12" disabled={!selectedImageSku || loading} onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "main" }); e.currentTarget.value = ""; }} type="file" /></label>
                <label className="block rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5"><span className="text-sm font-black text-ink">上传多图</span><span className="mt-1 block text-[11px] font-bold text-stone-400">背面图、细节图会追加到轮播</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2 min-h-12" disabled={!selectedImageSku || loading} multiple onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "gallery" }); e.currentTarget.value = ""; }} type="file" /></label>
              </div>
            </div>
            <div className="admin-panel">
              <h2 className="mb-1 text-lg font-black text-ink">按文件名批量上传</h2>
              <p className="mb-3 text-xs text-stone-500">主图文件名：SKU.jpg，例如 women-shirts-001.jpg。多图文件名：SKU-1.jpg、SKU-2.jpg。上传后自动匹配 SKU 并写入商品图片字段。</p>
              <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input min-h-12" disabled={loading} multiple onChange={e => { void uploadImages(e.target.files); e.currentTarget.value = ""; }} type="file" />
            </div>
            {imageResults.length > 0 ? <ResultTable results={imageResults} /> : null}
          </section>
        ) : null}

        {/* ── TAB: Categories ─────────────────────────────── */}
        {tab === "categories" ? <CategoriesManager activePassword={activePassword} authHeaders={adminAuthHeaders} toast={toast} confirm={setConfirm} dismissConfirm={dismissConfirm} /> : null}

        {tab === "suppliers" ? <SuppliersManager authHeaders={adminAuthHeaders} initialSuppliers={suppliers} onChanged={loadSuppliers} toast={toast} /> : null}

        {/* ── TAB: Skroutz Feed ───────────────────────────── */}
        {tab === "skroutz" ? (
          <section className="flex flex-col gap-5">
            {/* Header */}
            <div className="admin-panel">
              <h2 className="text-lg font-black text-ink">Skroutz Feed 状态</h2>
              <p className="mt-1 text-xs text-stone-400">将此 Feed 链接提交给 Skroutz，用于同步商品名称、价格、库存、图片和商品链接。</p>
              <div className="mt-4 flex items-center gap-2">
                {feedStats.missingRequired === 0 && feedStats.noStock === 0 ? (
                  <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">Feed 状态良好，可以提交给 Skroutz</span>
                ) : (
                  <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                    {feedStats.missingRequired} 个有库存商品缺少 Skroutz 必填信息，{feedStats.noStock} 个商品无库存；这些商品不会进入 Feed。
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
              {[{ label: "Feed 商品数", v: feedStats.total, color: "" }, { label: "缺 Skroutz 必填", v: feedStats.missingRequired, color: "" }, { label: "缺公网主图", v: feedStats.noImage, color: feedStats.noImage > 0 ? "" : "" }, { label: "缺描述", v: feedStats.noDesc, color: "" }, { label: "无库存", v: feedStats.noStock, color: "" }, { label: "测试商品隐藏", v: feedStats.testHidden, color: "" }].map(s => (
                <div key={s.label} className="rounded-2xl border border-stone-100 bg-white p-3 text-center shadow-sm shadow-stone-900/5 sm:p-5">
                  <p className={`text-2xl font-black ${(s.label === "缺公网主图"||s.label==="缺描述") && s.v > 0 ? "text-amber-600" : s.label === "无库存" && s.v > 0 ? "text-red-500" : "text-ink"}`}>{s.v}</p>
                  <p className="mt-1 text-xs font-bold text-stone-400">{s.label}</p>
                  {s.label === "缺 Skroutz 必填" ? <p className="mt-1 text-[10px] text-stone-400">EAN、MPN、颜色、尺码等按品类检查</p> : null}
                  {s.label === "缺公网主图" ? <p className="mt-1 text-[10px] text-stone-400">缺公网主图不会进入 Feed</p> : null}
                  {s.label === "缺描述" ? <p className="mt-1 text-[10px] text-stone-400">缺描述影响信息完整度</p> : null}
                  {s.label === "无库存" ? <p className="mt-1 text-[10px] text-stone-400">无库存不会进入 Feed</p> : null}
                  {s.label === "测试商品隐藏" ? <p className="mt-1 text-[10px] text-stone-400">TEST / DEMO 不输出</p> : null}
                </div>
              ))}
            </div>

            {/* Feed link card */}
            <div className="admin-panel">
              <h3 className="text-sm font-black text-ink">Feed 地址</h3>
              <p className="mt-1 text-xs text-stone-400">将此链接复制到 Skroutz 商家后台，用于同步商品名称、价格、库存、图片和链接。</p>
              <div className="mt-3 grid gap-2 rounded-2xl bg-stone-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <code className="flex-1 text-sm font-mono font-bold text-ink break-all">{typeof window !== "undefined" ? window.location.origin : ""}/feed.xml</code>
                <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white transition hover:bg-stone-800" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/feed.xml`); toast("Feed 链接已复制"); }} type="button">复制链接</button>
                <a className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-black text-ink transition hover:bg-stone-50" href="/feed.xml" rel="noreferrer" target="_blank">打开 Feed</a>
              </div>
            </div>

            {/* Quick checks */}
            <div className="admin-panel">
              <h3 className="text-sm font-black text-ink">Feed 检查</h3>
              <p className="mt-1 text-xs text-stone-400">快速查看需要处理的商品，点击按钮跳转到商品列表并筛选。</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[{k:"noimg",l:"查看缺图片商品"},{k:"nodesc",l:"查看缺描述商品"},{k:"nosizestock",l:"查看未分尺码商品"},{k:"nostock",l:"查看库存为0商品"}].map(b => (
                  <button key={b.k} className="min-h-11 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-black text-ink transition hover:bg-stone-50" onClick={() => { setFilterStatus(b.k); setTab("dashboard"); }} type="button">{b.l}</button>
                ))}
              </div>
            </div>

            {/* How to use */}
            <div className="rounded-2xl border border-stone-100 bg-stone-50/50 p-5 shadow-sm shadow-stone-900/5">
              <h3 className="text-sm font-black text-ink">如何使用这个 Feed？</h3>
              <div className="mt-3 space-y-2 text-xs text-stone-600">
                <p>1. 确认商品信息完整（图片、价格、库存、描述）。</p>
                <p>2. 复制上方 Feed 链接。</p>
                <p>3. 将链接提交给 Skroutz 商家后台。</p>
                <p>4. 后续修改商品后，Skroutz 会通过 Feed 自动同步最新数据。</p>
              </div>
            </div>
          </section>
        ) : null}

      </div>

      {posReceiptDetail ? (
        <PosReceiptPreview
          order={posReceiptDetail.order}
          items={posReceiptDetail.items}
          payments={posReceiptDetail.payments}
          paperWidth="80mm"
          language={printLanguage}
          storeSettings={initialPrintSettings}
          onClose={() => setPosReceiptDetail(null)}
        />
      ) : null}

      {labelPreviewItems ? (
        <LabelPrintPreview
          labels={labelPreviewItems}
          labelSize={labelSize}
          language={printLanguage}
          storeName={initialPrintSettings.business_name}
          showSupplierSku={labelShowSupplierSku}
          onClose={() => setLabelPreviewItems(null)}
        />
      ) : null}

      {/* Confirm dialog for batch operations */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.desc}
        confirmText={confirm.confirmText}
        variant={confirm.variant}
        loading={loading}
        onConfirm={confirm.action}
        onCancel={dismissConfirm}
      />
    </main>
  );
}

/* ── Small components ─────────────────────────────────────── */
function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="block text-sm font-bold text-ink">{label}<div className="mt-2">{children}</div></label>;
}

function ImagePreview({ disabled, url, label, onDel }: { disabled: boolean; url: string; label: string; onDel: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <img alt={label} className="aspect-[4/5] w-full bg-stone-100 object-cover" src={url} />
      <div className="p-2"><p className="truncate text-xs font-bold text-stone-600" title={url}>{label}</p><button className="mt-1 rounded-md border border-red-200 px-3 py-1 text-xs font-bold text-red-700 disabled:opacity-50 hover:bg-red-50" disabled={disabled} onClick={onDel} type="button">删除</button></div>
    </div>
  );
}

function ImgThumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-400">缺图</span>;
  return <img alt="" className="h-11 w-9 rounded object-cover bg-stone-100" src={src} onError={() => setOk(false)} />;
}

function ProductCardThumb({ alt, src }: { alt: string; src: string }) {
  const [ok, setOk] = useState(Boolean(src));
  useEffect(() => setOk(Boolean(src)), [src]);
  if (!ok) {
    return <span aria-label={`${alt} 暂无图片`} className="flex h-20 w-16 shrink-0 items-center justify-center rounded-xl bg-stone-100 px-2 text-center text-[10px] font-black text-stone-400">暂无图片</span>;
  }
  return <img alt={alt} className="h-20 w-16 shrink-0 rounded-xl bg-stone-100 object-cover" loading="lazy" onError={() => setOk(false)} src={src} />;
}

const emptySupplierForm = { id: "", code: "", name: "", vat_number: "", contact_name: "", phone: "", email: "", address: "", country: "Greece", notes: "", active: true };

function SuppliersManager({ authHeaders, initialSuppliers, onChanged, toast }: { authHeaders: () => Record<string, string>; initialSuppliers: Supplier[]; onChanged: () => Promise<void>; toast: (m: string, t?: "ok" | "err") => void }) {
  const [form, setForm] = useState(emptySupplierForm);
  const [saving, setSaving] = useState(false);

  function edit(supplier: Supplier) {
    setForm({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      vat_number: supplier.vat_number || "",
      contact_name: supplier.contact_name || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      country: supplier.country || "",
      notes: supplier.notes || "",
      active: supplier.active,
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { toast("请填写供货商编号和名称。", "err"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/suppliers", { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "供货商保存失败");
      toast(form.id ? "供货商已更新" : "供货商已新增");
      setForm(emptySupplierForm);
      await onChanged();
    } catch (error) { toast(error instanceof Error ? error.message : "供货商保存失败", "err"); }
    finally { setSaving(false); }
  }

  async function deactivate(id: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/suppliers", { method: "DELETE", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "停用失败");
      toast("供货商已停用");
      if (form.id === id) setForm(emptySupplierForm);
      await onChanged();
    } catch (error) { toast(error instanceof Error ? error.message : "停用失败", "err"); }
    finally { setSaving(false); }
  }

  return <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.4fr)]">
    <form className="admin-panel" onSubmit={save}>
      <h2 className="text-lg font-black text-ink">{form.id ? "编辑供货商" : "新增供货商"}</h2>
      <p className="mt-1 text-xs text-stone-500">只有编号和名称必填，其余信息都可以留空。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="供货商编号"><input className="input" required value={form.code} onChange={e => setForm(current => ({ ...current, code: e.target.value }))} /></Field>
        <Field label="供货商名称"><input className="input" required value={form.name} onChange={e => setForm(current => ({ ...current, name: e.target.value }))} /></Field>
        <Field label="VAT / AFM"><input className="input" value={form.vat_number} onChange={e => setForm(current => ({ ...current, vat_number: e.target.value }))} /></Field>
        <Field label="联系人"><input className="input" value={form.contact_name} onChange={e => setForm(current => ({ ...current, contact_name: e.target.value }))} /></Field>
        <Field label="电话"><input className="input" value={form.phone} onChange={e => setForm(current => ({ ...current, phone: e.target.value }))} /></Field>
        <Field label="邮箱"><input className="input" type="email" value={form.email} onChange={e => setForm(current => ({ ...current, email: e.target.value }))} /></Field>
        <Field label="国家"><input className="input" value={form.country} onChange={e => setForm(current => ({ ...current, country: e.target.value }))} /></Field>
        <Field label="状态"><select className="input" value={form.active ? "active" : "inactive"} onChange={e => setForm(current => ({ ...current, active: e.target.value === "active" }))}><option value="active">启用</option><option value="inactive">停用</option></select></Field>
        <div className="sm:col-span-2"><Field label="地址"><input className="input" value={form.address} onChange={e => setForm(current => ({ ...current, address: e.target.value }))} /></Field></div>
        <div className="sm:col-span-2"><Field label="备注"><textarea className="input min-h-20" value={form.notes} onChange={e => setForm(current => ({ ...current, notes: e.target.value }))} /></Field></div>
      </div>
      <div className="mt-4 flex gap-2"><button className="admin-button-primary" disabled={saving} type="submit">{saving ? "保存中..." : "保存供货商"}</button>{form.id ? <button className="admin-button-secondary" onClick={() => setForm(emptySupplierForm)} type="button">取消编辑</button> : null}</div>
    </form>
    <div className="admin-panel overflow-hidden">
      <h2 className="text-lg font-black text-ink">供货商列表</h2>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500"><th className="py-2 pr-3">编号</th><th className="py-2 pr-3">名称</th><th className="py-2 pr-3">联系方式</th><th className="py-2 pr-3">国家</th><th className="py-2 pr-3">状态</th><th className="py-2 text-right">操作</th></tr></thead><tbody>{initialSuppliers.map(supplier => <tr className="border-b border-stone-100" key={supplier.id}><td className="py-3 pr-3 font-mono text-xs">{supplier.code}</td><td className="py-3 pr-3 font-bold">{supplier.name}</td><td className="py-3 pr-3 text-xs text-stone-500">{supplier.phone || supplier.email || "-"}</td><td className="py-3 pr-3">{supplier.country || "-"}</td><td className="py-3 pr-3">{supplier.active ? "启用" : "停用"}</td><td className="py-3 text-right"><button className="mr-3 font-bold text-olive" onClick={() => edit(supplier)} type="button">编辑</button>{supplier.active ? <button className="font-bold text-red-600" disabled={saving} onClick={() => void deactivate(supplier.id)} type="button">停用</button> : null}</td></tr>)}</tbody></table>{initialSuppliers.length === 0 ? <p className="py-8 text-center text-sm text-stone-400">尚未添加供货商</p> : null}</div>
    </div>
  </section>;
}

function CategoriesManager({ activePassword, authHeaders, toast, confirm, dismissConfirm }: { activePassword: string; authHeaders: () => Record<string, string>; toast: (m: string, t?: "ok" | "err") => void; confirm: (c: { open: boolean; title: string; desc: string; confirmText: string; variant: "danger"|"success"|"default"; action: () => void }) => void; dismissConfirm: () => void }) {
  const [cats, setCats] = useState<Array<Record<string, unknown>>>([]);
  const [subs, setSubs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  async function load() { setLoading(true); try { const r = await fetch("/api/admin/categories", { headers: authHeaders() }); const d = await r.json(); setCats(d.categories || []); setSubs(d.subcategories || []); } catch {} finally { setLoading(false); } }
  useEffect(() => { load(); }, [activePassword]);

  function updateCat(idx: number, key: string, val: unknown) { setCats(prev => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; }); }
  function updateSub(idx: number, key: string, val: unknown) { setSubs(prev => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; }); }
  function addCat() { const newCat = { id: "", slug: "", name_cn: "", name_en: "", name_gr: "", image_url: "", sort_order: cats.length + 1, is_active: true }; setCats(prev => [...prev, newCat as Record<string, unknown>]); }
  function addSub(catId: string) { const newSub = { id: "", category_id: catId, slug: "", name_cn: "", name_en: "", name_gr: "", sort_order: subs.filter(s => s.category_id === catId).length + 1, is_active: true }; setSubs(prev => [...prev, newSub as Record<string, unknown>]); }
  function removeSub(idx: number) { const s = subs[idx]; const id = String(s.id||""); const slug = String(s.slug||""); confirm({ open: true, title: "删除二级分类", desc: `确认删除二级分类 ${slug}？`, confirmText: "确认删除", variant: "danger", action: () => { setSubs(prev => prev.filter(x => String(x.id||"") !== id || String(x.slug||"") !== slug)); dismissConfirm(); } }); }
  function removeCat(idx: number) { const c = cats[idx]; const slug = String(c.slug||""); const id = String(c.id||""); if (!slug) return; confirm({ open: true, title: "删除分类", desc: `确认删除分类 ${slug}？`, confirmText: "确认删除", variant: "danger", action: () => { setCats(prev => prev.filter(x => String(x.id||"") !== id || String(x.slug||"") !== slug)); dismissConfirm(); } }); }

  async function save() { setLoading(true); try { await fetch("/api/admin/categories", { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ categories: cats, subcategories: subs }) }); toast("分类已保存"); load(); } catch { toast("保存失败", "err"); } finally { setLoading(false); } }

  async function uploadCategoryImage(idx: number, file: File | null) {
    if (!file) return;
    const categoryId = String(cats[idx]?.id || "");
    if (!categoryId) {
      toast("请先保存分类，再上传分类图片。", "err");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/settings/upload?target=category&categoryId=${encodeURIComponent(categoryId)}`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Category image upload failed");
      updateCat(idx, "image_url", d.url);
      toast("分类图片已上传并发布。");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Category image upload failed", "err");
    } finally {
      setLoading(false);
    }
  }

  function subForCat(catId: string) { return subs.filter(s => s.category_id === catId); }

  return (
    <section className="flex flex-col gap-5">
      {/* 一级分类 */}
      <div className="admin-panel">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-black text-ink">一级分类</h2><button className="min-h-10 rounded-xl border border-stone-200 px-4 py-2 text-xs font-black hover:bg-stone-50" onClick={addCat} type="button">+ 新增</button></div>
        <p className="mb-3 text-xs text-stone-400">slug 只允许小写英文和横线。停用后前台不再显示，但已有商品不受影响。</p>
        <div className="grid gap-3 lg:hidden">
          {cats.map((c, i) => (
            <div key={i} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-ink">{String(c.slug || "未设置 slug")} · {String(c.name_cn || fallbackCategoryNamesCn[String(c.slug || "")] || c.name_en || "新分类")}</p>
                <label className="flex shrink-0 items-center gap-1 text-xs font-bold text-stone-500">
                  <input type="checkbox" checked={c.is_active !== false} onChange={e => updateCat(i, "is_active", e.target.checked)} />
                  启用
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold text-stone-500">slug<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base font-mono" value={String(c.slug||"")} onChange={e => updateCat(i, "slug", e.target.value.replace(/[^a-z0-9-]/g,"").toLowerCase())} /></label>
                <label className="block text-xs font-bold text-stone-500">排序<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" type="number" value={Number(c.sort_order||0)} onChange={e => updateCat(i, "sort_order", parseInt(e.target.value)||0)} /></label>
                <label className="block text-xs font-bold text-stone-500">中文<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(c.name_cn||"")} onChange={e => updateCat(i, "name_cn", e.target.value)} /></label>
                <label className="block text-xs font-bold text-stone-500">English<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(c.name_en||"")} onChange={e => updateCat(i, "name_en", e.target.value)} /></label>
                <label className="block text-xs font-bold text-stone-500 sm:col-span-2">Category image URL<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(c.image_url||"")} onChange={e => updateCat(i, "image_url", e.target.value)} /></label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  {String(c.image_url || "").trim() ? <img alt="" className="h-16 w-12 rounded-lg bg-stone-100 object-cover" src={String(c.image_url)} /> : <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-stone-100 text-[10px] font-bold text-stone-400">No image</div>}
                  <label className="min-h-10 cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black hover:bg-stone-50">
                    Upload image
                    <input accept="image/jpeg,image/png,image/webp" className="hidden" disabled={loading} type="file" onChange={e => { void uploadCategoryImage(i, e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
                  </label>
                </div>
                <label className="block text-xs font-bold text-stone-500 sm:col-span-2">Ελληνικά<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(c.name_gr||"")} onChange={e => updateCat(i, "name_gr", e.target.value)} /></label>
              </div>
              <button className="mt-3 min-h-10 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50" onClick={() => removeCat(i)} type="button">删除分类</button>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm">
          <thead><tr className="bg-stone-50/80 text-stone-400"><th className="py-2 px-2 text-xs font-bold">slug</th><th className="py-2 px-2 text-xs font-bold">中文</th><th className="py-2 px-2 text-xs font-bold">English</th><th className="py-2 px-2 text-xs font-bold">分类图</th><th className="py-2 px-2 text-xs font-bold">Ελληνικά</th><th className="py-2 px-2 text-xs font-bold w-14">排序</th><th className="py-2 px-2 text-xs font-bold w-12">启用</th><th className="py-2 px-2 text-xs font-bold w-12">删除</th></tr></thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={i} className="border-t border-stone-50">
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-base font-mono sm:text-xs" value={String(c.slug||"")} onChange={e => updateCat(i, "slug", e.target.value.replace(/[^a-z0-9-]/g,"").toLowerCase())} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-base sm:text-xs" value={String(c.name_cn||"")} onChange={e => updateCat(i, "name_cn", e.target.value)} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-base sm:text-xs" value={String(c.name_en||"")} onChange={e => updateCat(i, "name_en", e.target.value)} /></td>
                <td className="py-1.5 px-2">
                  <div className="flex min-w-64 items-center gap-2">
                    {String(c.image_url || "").trim() ? <img alt="" className="h-10 w-8 rounded bg-stone-100 object-cover" src={String(c.image_url)} /> : null}
                    <input className="w-full rounded border border-stone-200 px-1.5 py-1 text-base sm:text-xs" placeholder="https://..." value={String(c.image_url||"")} onChange={e => updateCat(i, "image_url", e.target.value)} />
                    <label className="shrink-0 cursor-pointer rounded border border-stone-200 bg-white px-2 py-1 text-xs font-bold hover:bg-stone-50">
                      上传
                      <input accept="image/jpeg,image/png,image/webp" className="hidden" disabled={loading} type="file" onChange={e => { void uploadCategoryImage(i, e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
                    </label>
                  </div>
                </td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-base sm:text-xs" value={String(c.name_gr||"")} onChange={e => updateCat(i, "name_gr", e.target.value)} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-center text-base sm:text-xs" type="number" value={Number(c.sort_order||0)} onChange={e => updateCat(i, "sort_order", parseInt(e.target.value)||0)} /></td>
                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={c.is_active !== false} onChange={e => updateCat(i, "is_active", e.target.checked)} /></td>
                <td className="py-1.5 px-2 text-center"><button className="text-xs font-bold text-red-400 hover:text-red-600" onClick={() => removeCat(i)} type="button">×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* 二级分类 */}
      <div className="admin-panel">
        <h2 className="mb-3 text-lg font-black text-ink">二级分类</h2>
        {cats.filter(c => c.is_active !== false).map((c, ci) => { const catId = String(c.id||""); const catSubs = subForCat(catId); const isOpen = !collapsed.has(catId) && (ci === 0 || collapsed.size <= ci); return (
          <div key={catId} className="mb-3 overflow-hidden rounded-2xl border border-stone-200 last:mb-0">
            <div className="flex min-h-12 cursor-pointer items-center justify-between gap-3 bg-stone-50 px-3 py-2" onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(catId)) n.delete(catId); else n.add(catId); return n; })}>
              <h3 className="min-w-0 text-sm font-bold text-ink"><span className="break-words">{String(c.slug || "未设置 slug")} · {String(c.name_cn || fallbackCategoryNamesCn[String(c.slug || "")] || c.name_en || "未命名分类")}</span> <span className="text-xs font-normal text-stone-400">— {catSubs.length} 个二级分类</span></h3>
              <div className="flex items-center gap-2">
                <button className="min-h-9 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black hover:bg-stone-100" onClick={e => { e.stopPropagation(); addSub(catId); }} type="button">+ 新增</button>
                <span className="text-xs text-stone-400">{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>
            {isOpen && catSubs.length > 0 ? (
              <>
              <div className="grid gap-3 p-3 lg:hidden">
                {catSubs.map((s) => { const gi = subs.findIndex(x => x === s); return (
                  <div key={gi} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-black text-ink">{String(s.slug || "未设置 slug")} · {String(s.name_cn || fallbackSubcategoryNamesCn[String(s.slug || "")] || s.name_en || "新二级分类")}</p>
                      <label className="flex shrink-0 items-center gap-1 text-xs font-bold text-stone-500">
                        <input type="checkbox" checked={s.is_active !== false} onChange={e => updateSub(gi, "is_active", e.target.checked)} />
                        启用
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-bold text-stone-500">slug<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base font-mono" value={String(s.slug||"")} onChange={e => updateSub(gi, "slug", e.target.value.replace(/[^a-z0-9_-]/g,"").toLowerCase())} /></label>
                      <label className="block text-xs font-bold text-stone-500">排序<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" type="number" value={Number(s.sort_order||0)} onChange={e => updateSub(gi, "sort_order", parseInt(e.target.value)||0)} /></label>
                      <label className="block text-xs font-bold text-stone-500">中文<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(s.name_cn||"")} onChange={e => updateSub(gi, "name_cn", e.target.value)} /></label>
                      <label className="block text-xs font-bold text-stone-500">English<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(s.name_en||"")} onChange={e => updateSub(gi, "name_en", e.target.value)} /></label>
                      <label className="block text-xs font-bold text-stone-500 sm:col-span-2">Ελληνικά<input className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base" value={String(s.name_gr||"")} onChange={e => updateSub(gi, "name_gr", e.target.value)} /></label>
                    </div>
                    <button className="mt-3 min-h-10 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50" onClick={() => removeSub(gi)} type="button">删除二级分类</button>
                  </div>
                );})}
              </div>
              <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm">
                <thead><tr className="bg-stone-50/80 text-stone-400"><th className="py-1.5 px-2 text-[11px] font-bold">slug</th><th className="py-1.5 px-2 text-[11px] font-bold">中文</th><th className="py-1.5 px-2 text-[11px] font-bold">English</th><th className="py-1.5 px-2 text-[11px] font-bold">Ελληνικά</th><th className="py-1.5 px-2 text-[11px] font-bold w-12">排序</th><th className="py-1.5 px-2 text-[11px] font-bold w-10">启用</th><th className="py-1.5 px-2 text-[11px] font-bold w-10">删除</th></tr></thead>
                <tbody>
                  {catSubs.map((s, si) => { const gi = subs.findIndex(x => x === s); return (
                    <tr key={gi} className="border-t border-stone-50">
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-base font-mono sm:text-[11px]" value={String(s.slug||"")} onChange={e => updateSub(gi, "slug", e.target.value.replace(/[^a-z0-9_-]/g,"").toLowerCase())} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-base sm:text-[11px]" value={String(s.name_cn||"")} onChange={e => updateSub(gi, "name_cn", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-base sm:text-[11px]" value={String(s.name_en||"")} onChange={e => updateSub(gi, "name_en", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-base sm:text-[11px]" value={String(s.name_gr||"")} onChange={e => updateSub(gi, "name_gr", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-center text-base sm:text-[11px]" type="number" value={Number(s.sort_order||0)} onChange={e => updateSub(gi, "sort_order", parseInt(e.target.value)||0)} /></td>
                      <td className="py-1 px-2 text-center"><input type="checkbox" checked={s.is_active !== false} onChange={e => updateSub(gi, "is_active", e.target.checked)} /></td>
                      <td className="py-1 px-2 text-center"><button className="text-[11px] font-bold text-red-400 hover:text-red-600" onClick={() => removeSub(gi)} type="button">×</button></td>
                    </tr>
                  );})}
                </tbody>
              </table></div>
              </>
            ) : <p className="text-xs text-stone-400">暂无二级分类</p>}
          </div>
        );})}
      </div>

      <div className="admin-sticky-actions">
        <button className="admin-button-primary w-full sm:w-auto" onClick={save} disabled={loading} type="button">保存全部分类</button>
        <p className="text-xs font-bold text-stone-400">修改一级分类或二级分类后，请点击保存才会写入数据库。</p>
      </div>
    </section>
  );
}

function resultStatus(result: ApiResult) {
  const tone = result.statusTone || (result.ok ? "success" : "error");
  if (tone === "info") return { label: result.statusLabel || "已校验", className: "bg-blue-100 text-blue-700", textClassName: "text-blue-700" };
  if (tone === "pending") return { label: result.statusLabel || "待处理", className: "bg-amber-100 text-amber-800", textClassName: "text-amber-700" };
  if (tone === "error") return { label: result.statusLabel || "失败", className: "bg-red-100 text-red-700", textClassName: "text-red-600" };
  return { label: result.statusLabel || "成功", className: "bg-green-100 text-green-700", textClassName: "text-green-700" };
}

function ResultTable({ results }: { results: ApiResult[] }) {
  return (
    <div className="mt-4">
      <div className="grid gap-2 lg:hidden">
        {results.map((r, i) => {
          const status = resultStatus(r);
          return <article className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5" key={`${r.sku}-card-${r.fileName || r.rowNumber || i}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-stone-500">{r.fileName || `第 ${r.rowNumber} 行`}</p>
                <p className="mt-1 truncate font-mono text-sm font-black text-ink">{r.sku || "无 SKU"}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${status.className}`}>{status.label}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">{r.message || "-"}</p>
            {r.translateError ? <p className="mt-1 text-xs font-bold text-orange-600">翻译错误: {r.translateError}</p> : null}
          </article>;
        })}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-stone-200 text-stone-500"><th className="py-2 pr-3 text-xs font-bold">#</th><th className="py-2 pr-3 text-xs font-bold">SKU</th><th className="py-2 pr-3 text-xs font-bold">状态</th><th className="py-2 pr-3 text-xs font-bold">说明</th></tr></thead>
          <tbody>
            {results.map((r, i) => {
              const status = resultStatus(r);
              return <tr className="border-b border-stone-50" key={`${r.sku}-${r.fileName || r.rowNumber || i}`}>
                <td className="py-2 pr-3 text-xs">{r.fileName || `第 ${r.rowNumber} 行`}</td><td className="py-2 pr-3 text-xs font-mono">{r.sku}</td>
                <td className={`py-2 pr-3 text-xs font-bold ${status.textClassName}`}>{status.label}</td>
                <td className="py-2 pr-3 text-xs">{r.message}{r.translateError ? <span className="ml-2 text-orange-600">翻译错误: {r.translateError}</span> : null}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
