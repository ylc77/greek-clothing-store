"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  categories,
  isProductCategory,
  isProductSubcategory,
  subcategoriesByCategory,
  subcategoryList,
  type ProductCategory,
  type ProductFormData,
} from "@/lib/types";
import { getTotalStock as effectiveStock } from "@/lib/product-stock";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/admin-toast";
import { PosReceiptPreview } from "@/components/pos-receipt-preview";
import { LabelPrintPreview, type LabelSize, type PrintableVariantLabel } from "@/components/label-print-preview";

/* ── Types ───────────────────────────────────────────────── */
type AdminProduct = ProductFormData & { id: string; size_stock?: Record<string, number> | null };
type ApiResult = { rowNumber?: number; fileName?: string; sku: string; ok: boolean; message: string; imageUrl?: string; translated?: boolean; translateError?: string };
type CsvRow = Record<string, string | number>;
type TranslationResult = { name_gr: string; description_gr: string; name_en: string; description_en: string };
type ImageUploadOptions = { sku?: string; mode?: "main" | "gallery" };
type ImageDeleteOptions = { sku: string; kind: "main" | "gallery"; index?: number };
type Tab = "dashboard" | "check" | "quickAdd" | "quickSale" | "pos" | "posOrders" | "inventory" | "labels" | "add" | "csv" | "images" | "skroutz" | "categories";
type InventoryItem = {
  product_id: number;
  product_name: string;
  product_sku: string;
  variant_id: string;
  variant_sku: string;
  size: string | null;
  color: string | null;
  barcode: string | null;
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
};
type InventoryAdjustState = {
  item: InventoryItem | null;
  mode: "set_to" | "adjust_by";
  quantity: string;
  reason: string;
  submitting: boolean;
  message: string;
};
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
type PosVoidDialogState = {
  order: PosOrderListItem;
  reason: string;
  submitting: boolean;
  message: string;
};
type QuickAddState = {
  category: ProductCategory;
  subcategory: string;
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
const emptyProduct: ProductFormData = { sku: "", name_cn: "", name_gr: "", name_en: "", description_cn: "", description_gr: "", description_en: "", category: "men", subcategory: "tshirts", price: 0, stock: 0, sizes: "", image_url: "", image_urls: "", brand: "", barcode: "", vat: 24, color: "", skroutz_url: "", is_active: true, fit_type: "regular", material: "", ai_keywords: "", style_tags: "", size_chart: "", material_verified: false };
const csvFields = ["sku","name_cn","description_cn","name_en","description_en","name_gr","description_gr","category","subcategory","price","stock","sizes","size_stock","image_url","image_urls","brand","barcode","vat","color","skroutz_url","is_active","material","fit_type","ai_keywords","style_tags","size_chart","material_verified"];
const quickCsvFields = ["sku","name_cn","description_cn","category","subcategory","price","stock","sizes","brand","color","image_url","image_urls","is_active"];
const csvFieldLabels: Record<string, string> = {
  sku: "SKU（必填，唯一商品编号）",
  name_cn: "中文名称（必填，可用于自动翻译）",
  description_cn: "中文描述（必填，可用于自动翻译）",
  name_en: "英文名称（选填，可由 AI 生成）",
  description_en: "英文描述（选填，可由 AI 生成）",
  name_gr: "希腊语名称（选填，可由 AI 生成）",
  description_gr: "希腊语描述（选填，可由 AI 生成）",
  category: "一级分类（必填：men/women/shoes/bags/luggage/hats/jewelry/other）",
  subcategory: "二级分类（必填，按后台分类填写）",
  price: "价格（必填，数字，不加 €）",
  stock: "总库存（必填，数字）",
  sizes: "尺码（选填，如 S,M,L）",
  size_stock: "尺码库存（选填，如 S:2,M:3,L:1）",
  image_url: "主图 URL（选填，可后续上传图片自动绑定）",
  image_urls: "多图 URL（选填，多个用逗号或换行）",
  brand: "品牌（选填）",
  barcode: "条码 / EAN（选填，有真实条码再填）",
  vat: "VAT（选填，默认 24）",
  color: "颜色（选填，建议填写）",
  skroutz_url: "Skroutz 链接（选填，没有可留空）",
  is_active: "是否上架（TRUE/FALSE）",
  material: "材质（选填）",
  fit_type: "版型（选填：regular/slim/loose）",
  ai_keywords: "AI 关键词（选填）",
  style_tags: "风格标签（选填）",
  size_chart: "尺码表 JSON（选填，高级字段）",
  material_verified: "材质已人工确认（TRUE/FALSE）",
};
const csvHeaderAliases = new Map(Object.entries(csvFieldLabels).flatMap(([field, label]) => [[field, field], [label, field]]));
const tabs: { key: Tab; label: string }[] = [
  { key: "pos", label: "POS 收银" },
  { key: "posOrders", label: "POS 订单" },
  { key: "inventory", label: "库存管理" },
  { key: "labels", label: "标签打印" },
  { key: "dashboard", label: "商品列表" }, { key: "quickAdd", label: "拍照上新" }, { key: "quickSale", label: "快速售出" }, { key: "check", label: "上线检查" }, { key: "add", label: "新增/编辑" }, { key: "csv", label: "CSV 导入" }, { key: "images", label: "图片上传" }, { key: "categories", label: "分类管理" }, { key: "skroutz", label: "Skroutz Feed" },
];
const primaryTabKeys: Tab[] = ["quickAdd", "pos", "posOrders", "quickSale", "dashboard", "check"];
const managementTabKeys: Tab[] = ["inventory", "labels", "add", "images", "csv", "categories", "skroutz"];
const tabLabelByKey = new Map(tabs.map(item => [item.key, item.label]));
const clothingSizeOptions = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const shoeSizeOptions = ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];
const oneSizeOptions = ["ONE SIZE"];
const sizeSortOrder = [...clothingSizeOptions, ...shoeSizeOptions, ...oneSizeOptions];
function sizeKindForCategory(category: string) {
  const normalized = category.trim().toLowerCase();
  if (normalized === "shoes") return "shoes";
  if (normalized === "men" || normalized === "women") return "clothing";
  return "one";
}
function sizeOptionsForCategory(category: string) {
  const kind = sizeKindForCategory(category);
  if (kind === "shoes") return shoeSizeOptions;
  if (kind === "clothing") return clothingSizeOptions;
  return oneSizeOptions;
}
function stockTotal(stock: Record<string, number>) {
  return Object.values(stock).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}
function inventoryIssueCount(data: InventoryReconciliation | null) {
  if (!data) return 0;
  return Object.values(data).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
}
function formatAdminDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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
  };
  return labels[value] || value;
}
function inventoryStatusFor(item: InventoryItem, lowStockThreshold: number) {
  const reconciled = item.stock_matches_legacy && item.size_stock_matches_legacy;
  if (!reconciled) return { key: "mismatch", label: "对账异常", className: "bg-red-50 text-red-700" };
  if (!item.active) return { key: "inactive", label: "停用", className: "bg-stone-100 text-stone-500" };
  if (item.quantity_available <= 0) return { key: "out_of_stock", label: "缺货", className: "bg-red-50 text-red-700" };
  if (item.quantity_available <= lowStockThreshold) return { key: "low_stock", label: "低库存", className: "bg-amber-50 text-amber-700" };
  return { key: "normal", label: "正常", className: "bg-emerald-50 text-emerald-700" };
}
function inventoryCsvStatus(item: InventoryItem, lowStockThreshold: number) {
  return inventoryStatusFor(item, lowStockThreshold).label;
}
const emptyQuickAdd: QuickAddState = {
  category: "men",
  subcategory: "tshirts",
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

/* ── Utilities ───────────────────────────────────────────── */
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && n === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((h) => csvHeaderAliases.get(h.trim()) || h.trim()) || [];
  const labels = headers.map((field) => csvFieldLabels[field] || field);
  let dataStartRow = 2;
  if (rows[0]?.every((value, index) => value.trim() === labels[index])) { rows.shift(); dataStartRow = 3; }
  return rows.map((values, i) => { const out: CsvRow = { rowNumber: i + dataStartRow }; headers.forEach((h, hi) => { out[h] = values[hi] || ""; }); return out; });
}
function csvCell(v: string) { return `"${v.replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, fields: string[], sample: string[]) {
  const labels = fields.map((field) => csvFieldLabels[field] || field);
  const csv = `${fields.join(",")}\n${labels.map(csvCell).join(",")}\n${sample.map(csvCell).join(",")}\n`;
  const b = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
}
function downloadCsvTemplate() {
  const sample = ["SKU-001","Chinese product name","Chinese product description","English product name","English product description","Greek product name","Greek product description","women","dresses","29.90","10","S,M,L","S:2,M:3,L:1","","","Store Brand","","24","black","","true","cotton","regular","dress summer elegant","casual summer","{\"S\":{\"bust\":\"84-88\"},\"M\":{\"bust\":\"88-92\"}}","true"];
  downloadCsv("products-template.csv", csvFields, sample);
}
function downloadQuickCsvTemplate() {
  const sample = ["SKU-001","Chinese product name","Chinese product description","women","dresses","29.90","10","S,M,L","Store Brand","black","","","true"];
  downloadCsv("products-quick-template.csv", quickCsvFields, sample);
}
function validatePreviewRow(row: CsvRow) {
  const errors: string[] = [];
  const sku = String(row.sku || "").trim(); const cat = String(row.category || "").trim(); const sub = String(row.subcategory || "").trim();
  const price = Number(String(row.price || "").replace(",", ".")); const stock = Number(String(row.stock || "").replace(",", "."));
  const vat = row.vat === undefined || row.vat === "" ? 24 : Number(String(row.vat).replace(",", "."));
  if (!sku) errors.push("SKU 必填");
  if (!isProductCategory(cat)) errors.push("一级分类无效或为空");
  if (isProductCategory(cat) && sub && !isProductSubcategory(cat, sub)) errors.push("二级分类无效");
  if (!Number.isFinite(price)) errors.push("价格必须是数字，不能带 € 或文字");
  if (!Number.isFinite(stock)) errors.push("库存必须是数字");
  if (!Number.isFinite(vat)) errors.push("VAT 必须是数字");
  return errors;
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
  return { ...p, sku: p.sku.trim(), name_cn: p.name_cn.trim(), name_gr: p.name_gr.trim(), name_en: p.name_en.trim(), description_cn: p.description_cn.trim(), description_gr: p.description_gr.trim(), description_en: p.description_en.trim(), subcategory: p.subcategory.trim(), price: Number(p.price), stock: Number(p.stock), sizes: p.sizes.trim(), image_url: img, image_urls: cleanImageUrls(p.image_urls, img), brand: p.brand.trim(), barcode: p.barcode.trim(), vat: Number(p.vat), color: p.color.trim(), skroutz_url: p.skroutz_url.trim(), is_active: p.is_active, fit_type: p.fit_type, material: p.material.trim(), ai_keywords: p.ai_keywords.trim(), style_tags: p.style_tags.trim(), size_chart: p.size_chart.trim() };
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
  if (width < 1000 && height < 1000) return `图片尺寸不足 ${width}×${height}`;
  return "";
}
function productIssues(product: AdminProduct) {
  const issues: { code: string; label: string; level: "block" | "warn" }[] = [];
  const stock = effectiveStock(product);
  const nameOk = hasText(product.name_gr) || hasText(product.name_en) || hasText(product.name_cn);
  const descOk = hasText(product.description_gr) || hasText(product.description_en) || hasText(product.description_cn);
  if (!hasText(product.sku)) issues.push({ code: "sku", label: "缺 SKU", level: "block" });
  if (isTestProductSku(product.sku)) issues.push({ code: "test", label: "测试 / Demo SKU，不进入 Feed", level: "block" });
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
  return product.is_active && !isTestProductSku(product.sku) && effectiveStock(product) > 0 && isHttpUrl(product.image_url) && Number(product.price) > 0;
}
function needsAiCompletion(product: AdminProduct) {
  const hasChinese = hasText(product.name_cn) || hasText(product.description_cn);
  const missingTranslation = hasChinese && (!hasText(product.name_en) || !hasText(product.description_en) || !hasText(product.name_gr) || !hasText(product.description_gr));
  const raw = product as Record<string, unknown>;
  const hasKeywords = Array.isArray(raw.ai_keywords) ? raw.ai_keywords.length > 0 : hasText(raw.ai_keywords);
  const hasStyleTags = Array.isArray(raw.style_tags) ? raw.style_tags.length > 0 : hasText(raw.style_tags);
  const missingMeta = (hasText(product.name_cn) || hasText(product.name_en) || hasText(product.name_gr)) && (!hasKeywords || !hasStyleTags || !hasText(raw.material));
  return missingTranslation || missingMeta;
}
/* ── Main component ──────────────────────────────────────── */
export function AdminDashboard() {
  const { toast } = useToast();
  const [password, setPassword] = useState(""); const [activePassword, setActivePassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct); const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [translating, setTranslating] = useState(false);
  const [aiMetaLoading, setAiMetaLoading] = useState(false);
  const [aiCopyLoading, setAiCopyLoading] = useState(false);
  const [aiQuickCopyLoading, setAiQuickCopyLoading] = useState(false);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const editingIdRef = useRef<string | null>(null); editingIdRef.current = editingId;
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]); const [csvResults, setCsvResults] = useState<ApiResult[]>([]);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]); const [selectedImageSku, setSelectedImageSku] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoCompletingId, setAutoCompletingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; desc: string; confirmText: string; variant: "danger"|"success"|"default"; action: () => void; prompt?: boolean; promptValue?: string }>({ open: false, title: "", desc: "", confirmText: "确认", variant: "default", action: () => {} });
  const [newMainFile, setNewMainFile] = useState<File | null>(null); const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [sizeStock, setSizeStock] = useState<Record<string, number>>({});
  const [showSizeSummary, setShowSizeSummary] = useState(false);
  const [quickAdd, setQuickAdd] = useState<QuickAddState>(emptyQuickAdd);
  const [quickMainFile, setQuickMainFile] = useState<File | null>(null);
  const [quickBackFiles, setQuickBackFiles] = useState<File[]>([]);
  const [quickSizeStock, setQuickSizeStock] = useState<Record<string, number>>({});
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
  const [inventoryQ, setInventoryQ] = useState("");
  const [inventorySize, setInventorySize] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState<InventoryStatusFilter>("all");
  const [inventorySort, setInventorySort] = useState<InventorySort>("stock_asc");
  const [lowStockThreshold, setLowStockThreshold] = useState(3);
  const [movementVariantId, setMovementVariantId] = useState("");
  const [movementQ, setMovementQ] = useState("");
  const [movementType, setMovementType] = useState("");
  const [movementSourceType, setMovementSourceType] = useState("");
  const [movementLimit, setMovementLimit] = useState(50);
  const [adjustInventory, setAdjustInventory] = useState<InventoryAdjustState>({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" });
  const [labelOnlyMissingBarcode, setLabelOnlyMissingBarcode] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSize>("50x30");
  const [selectedLabelVariantIds, setSelectedLabelVariantIds] = useState<Set<string>>(new Set());
  const [labelGenerating, setLabelGenerating] = useState(false);
  const [labelMessage, setLabelMessage] = useState("");
  const [labelPreviewItems, setLabelPreviewItems] = useState<PrintableVariantLabel[] | null>(null);
  const posSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [posQuery, setPosQuery] = useState("");
  const [posResults, setPosResults] = useState<PosSearchItem[]>([]);
  const [posCart, setPosCart] = useState<PosCartItem[]>([]);
  const [posPaymentMethod, setPosPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [posDiscountTotal, setPosDiscountTotal] = useState("0");
  const [posLoading, setPosLoading] = useState(false);
  const [posCheckoutLoading, setPosCheckoutLoading] = useState(false);
  const [posMessage, setPosMessage] = useState("");
  const [posPreview, setPosPreview] = useState<Record<string, unknown> | null>(null);
  const [posLastOrder, setPosLastOrder] = useState<PosOrderResult | null>(null);
  const [posView, setPosView] = useState<PosOrdersView>("checkout");
  const [posOrders, setPosOrders] = useState<PosOrderListItem[]>([]);
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
  useEffect(() => { if (activePassword) { fetch("/api/admin/categories", { headers: { "x-admin-password": activePassword } }).then(r => r.json()).then(d => { setDbCats((d.categories||[]).filter((c:Record<string,unknown>) => c.is_active !== false)); setDbSubs((d.subcategories||[]).filter((s:Record<string,unknown>) => s.is_active !== false)); }).catch(() => {}); } }, [activePassword, tab]);

  // Search / filter state
  const [search, setSearch] = useState(""); const [filterCat, setFilterCat] = useState(""); const [filterSub, setFilterSub] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | active | inactive | noimg | badimage | nostock | nosizestock | demo

  const csvSummary = useMemo(() => {
    const valid = csvRows.filter(r => validatePreviewRow(r).length === 0).length;
    const needs = csvRows.filter(r => { if (validatePreviewRow(r).length > 0) return false; const nc = String(r.name_cn||"").trim(), dc = String(r.description_cn||"").trim(); if (!nc && !dc) return false; const ne = String(r.name_en||"").trim(), de = String(r.description_en||"").trim(), ng = String(r.name_gr||"").trim(), dg = String(r.description_gr||"").trim(); return !(ne && de && ng && dg); }).length;
    return { valid, invalid: csvRows.length - valid, needsTranslation: needs };
  }, [csvRows]);

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

  // Feed stats
  const feedStats = useMemo(() => {
    const activeRealProducts = products.filter(p => p.is_active && !isTestProductSku(p.sku));
    const stockReady = activeRealProducts.filter(p => effectiveStock(p) > 0);
    return {
      total: activeRealProducts.filter(entersSkroutzFeed).length,
      noImage: stockReady.filter(p => !isHttpUrl(p.image_url)).length,
      noDesc: stockReady.filter(p => !p.description_en && !p.description_gr && !p.description_cn).length,
      noStock: activeRealProducts.filter(p => effectiveStock(p) <= 0).length,
      testHidden: products.filter(p => p.is_active && isTestProductSku(p.sku)).length,
    };
  }, [products]);

  const filteredInventoryItems = useMemo(() => {
    const threshold = Math.max(0, Math.trunc(lowStockThreshold) || 0);
    let list = inventoryItems.filter(item => inventoryStatus === "all" || inventoryStatusFor(item, threshold).key === inventoryStatus);
    list = [...list].sort((a, b) => {
      if (inventorySort === "stock_desc") return b.quantity_available - a.quantity_available;
      if (inventorySort === "sku") return `${a.product_sku}-${a.variant_sku}`.localeCompare(`${b.product_sku}-${b.variant_sku}`);
      return a.quantity_available - b.quantity_available;
    });
    return list;
  }, [inventoryItems, inventoryStatus, inventorySort, lowStockThreshold]);

  const inventorySummary = useMemo(() => {
    const threshold = Math.max(0, Math.trunc(lowStockThreshold) || 0);
    return inventoryItems.reduce((summary, item) => {
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
  }, [inventoryItems, lowStockThreshold]);

  const filteredLabelItems = useMemo(() => {
    return filteredInventoryItems.filter(item => !labelOnlyMissingBarcode || !item.barcode);
  }, [filteredInventoryItems, labelOnlyMissingBarcode]);

  const selectedLabelItems = useMemo(() => {
    return inventoryItems.filter(item => selectedLabelVariantIds.has(item.variant_id));
  }, [inventoryItems, selectedLabelVariantIds]);

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
    const headers = ["sku", "name", "category", "subcategory", "status", "feed_status", "stock", "price", "image_url", "issues"];
    const rows = launchChecks.rows
      .filter(row => row.issues.length > 0)
      .map(({ product, issues, blockers, feedReady }) => [
        product.sku,
        product.name_cn || product.name_en || product.name_gr || "",
        product.category || "",
        product.subcategory || "",
        blockers.length > 0 ? "blocked" : "needs_review",
        feedReady ? "feed_ready" : "not_in_feed",
        String(effectiveStock(product)),
        String(product.price ?? ""),
        product.image_url || "",
        issues.map(issue => issue.label).join("；"),
      ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv, "\n"], { type: "text/csv;charset=utf-8" });
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
      item.active ? "TRUE" : "FALSE",
      String(item.quantity_on_hand),
      String(item.quantity_reserved),
      String(item.quantity_available),
      inventoryCsvStatus(item, lowStockThreshold),
      item.stock_matches_legacy && item.size_stock_matches_legacy ? "OK" : "MISMATCH",
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv, "\n"], { type: "text/csv;charset=utf-8" });
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
  async function api(path: string, init: RequestInit = {}) {
    const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "x-admin-password": activePassword, ...(init.headers || {}) } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  }
  async function readJson(r: Response, fallback: string) { const ct = r.headers.get("Content-Type")||""; if (ct.includes("json")) return r.json(); const t = await r.text(); throw new Error(t ? `${fallback}: ${t.slice(0, 160)}` : fallback); }

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
      headers: { "Content-Type": "application/json", "x-admin-password": activePassword, ...(init.headers || {}) },
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(posErrorMessage(data, "POS 请求失败"));
    return data;
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
        if (nextQty === existing.cartQuantity) toast("购物车数量不能超过当前可用库存", "err");
        return current.map(cartItem => cartItem.variant_id === item.variant_id ? { ...cartItem, ...item, cartQuantity: nextQty } : cartItem);
      }
      return [...current, { ...item, cartQuantity: 1 }];
    });
    setPosPreview(null);
    setPosMessage(`${item.variant_sku || item.product_sku} 已加入购物车`);
    window.setTimeout(() => posSearchInputRef.current?.focus(), 30);
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
      const message = "请先加入商品到购物车。";
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
    setPosCheckoutLoading(true);
    try {
      const result = (await posApi("/api/admin/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          paymentMethod: posPaymentMethod,
          discountTotal: posDiscount,
          items: posCart.map(item => ({ variantId: item.variant_id, quantity: item.cartQuantity })),
        }),
      })) as PosOrderResult;

      setPosLastOrder(result);
      setPosCart([]);
      setPosPreview(null);
      setPosMessage(result.alreadyProcessed ? "该订单已处理，没有重复扣库存。" : "收银完成，库存已扣减。");
      toast(result.alreadyProcessed ? "该订单已处理" : "收银完成");
      await loadProducts();
      if (inventoryItems.length > 0) await loadInventoryData();
      window.setTimeout(() => posSearchInputRef.current?.focus(), 60);
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 收银失败";
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
      title: "确认完成收银",
      desc: `确认完成收银？这会创建订单并扣减库存。金额：${formatEuro(posTotal)}，付款方式：${posPaymentMethod}。`,
      confirmText: "确认收银并扣库存",
      variant: "danger",
      action: () => {
        setConfirm(c => ({ ...c, open: false }));
        void executePosCheckout();
      },
    });
  }

  async function loadPosOrders() {
    setPosOrdersLoading(true);
    setPosOrdersMessage("");
    try {
      const params = new URLSearchParams();
      if (posOrderQ.trim()) params.set("q", posOrderQ.trim());
      params.set("status", posOrderStatus);
      params.set("paymentMethod", posOrderPaymentMethod);
      params.set("dateRange", posOrderDateRange);
      params.set("limit", "100");
      const data = await posApi(`/api/admin/pos/orders?${params.toString()}`);
      const orders = (Array.isArray(data.orders) ? data.orders : []) as PosOrderListItem[];
      setPosOrders(orders);
      if (orders.length === 0) setPosOrdersMessage("没有找到符合条件的 POS 订单。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 订单读取失败";
      setPosOrdersMessage(message);
      toast(message, "err");
    } finally {
      setPosOrdersLoading(false);
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

  async function submitPosVoid() {
    if (!posVoidDialog) return;
    const reason = posVoidDialog.reason.trim();
    if (reason.length < 3) {
      setPosVoidDialog(current => current ? { ...current, message: "请填写作废原因，至少 3 个字符。" } : current);
      return;
    }

    setPosVoidDialog(current => current ? { ...current, submitting: true, message: "" } : current);
    try {
      const data = await posApi(`/api/admin/pos/orders/${posVoidDialog.order.id}/void`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          clientRequestId: crypto.randomUUID(),
        }),
      });

      toast(data.alreadyProcessed ? "该订单已作废。" : "订单已作废，库存已加回。", "ok");
      setPosVoidDialog(null);
      await loadPosOrders();
      if (posOrderDetail?.order.id === posVoidDialog.order.id) {
        await loadPosOrderDetail(posVoidDialog.order.id);
      }
      void loadInventoryData();
      void loadProducts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "POS 订单作废失败";
      setPosVoidDialog(current => current ? { ...current, submitting: false, message } : current);
      toast(message, "err");
    }
  }

  async function loadProducts() { setLoading(true); try { const d = await api("/api/admin/products?limit=500"); setProducts(d.products||[]); } catch (e) { toast(e instanceof Error ? e.message : "商品读取失败", "err"); } finally { setLoading(false); } }
  useEffect(() => { if (activePassword) void loadProducts(); }, [activePassword]);

  async function loadInventoryOverview() {
    const params = new URLSearchParams();
    if (inventoryQ.trim()) params.set("q", inventoryQ.trim());
    if (inventorySize.trim()) params.set("size", inventorySize.trim());
    params.set("limit", "500");
    const d = await api(`/api/admin/inventory?${params.toString()}`);
    setInventoryItems(d.items || []);
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
  useEffect(() => { if (activePassword && (tab === "inventory" || tab === "labels")) void loadInventoryData(); }, [activePassword, tab]);
  function toggleLabelVariant(variantId: string) {
    setSelectedLabelVariantIds(prev => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }
  function setLabelSelection(items: InventoryItem[]) {
    setSelectedLabelVariantIds(new Set(items.map(item => item.variant_id)));
  }
  function labelFromInventoryItem(item: InventoryItem): PrintableVariantLabel {
    return {
      product_name: item.product_name,
      product_sku: item.product_sku,
      variant_id: item.variant_id,
      variant_sku: item.variant_sku,
      barcode: item.barcode,
      size: item.size,
      color: item.color,
      price: item.price,
      quantity_on_hand: item.quantity_on_hand,
      active: item.active,
    };
  }
  async function generateSelectedBarcodes() {
    const variantIds = Array.from(selectedLabelVariantIds);
    if (variantIds.length === 0) {
      toast("请先选择需要生成条码的变体", "err");
      return;
    }
    setLabelGenerating(true);
    setLabelMessage("");
    try {
      const result = await api("/api/admin/variants/generate-barcodes", {
        method: "POST",
        body: JSON.stringify({ variantIds, mode: "variant_sku", force: false }),
      });
      const errors = Array.isArray(result.errors) ? result.errors : [];
      const message = `已生成 ${Number(result.generatedCount || 0)} 个，跳过 ${Number(result.skippedCount || 0)} 个，失败 ${errors.length} 个。`;
      setLabelMessage(message);
      toast(message, errors.length > 0 ? "err" : "ok");
      await loadInventoryData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成条码失败";
      setLabelMessage(message);
      toast(message, "err");
    } finally {
      setLabelGenerating(false);
    }
  }
  function openLabelPreview() {
    const labels = selectedLabelItems
      .filter(item => item.barcode || item.variant_sku)
      .map(labelFromInventoryItem);
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
    if (activePassword && tab === "posOrders") {
      void loadPosOrders();
    }
  }, [activePassword, tab, posOrderStatus, posOrderPaymentMethod, posOrderDateRange]);
  function openInventoryAdjust(item: InventoryItem) {
    setAdjustInventory({ item, mode: "set_to", quantity: String(item.quantity_on_hand), reason: "", submitting: false, message: "" });
  }
  async function executeInventoryAdjustment() {
    const item = adjustInventory.item;
    if (!item) return;
    const quantity = Number(adjustInventory.quantity);
    setAdjustInventory(prev => ({ ...prev, submitting: true, message: "" }));
    try {
      const result = await api("/api/admin/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          variantId: item.variant_id,
          mode: adjustInventory.mode,
          quantity,
          reason: adjustInventory.reason.trim(),
          clientRequestId: crypto.randomUUID(),
        }),
      });
      const before = Number(result.quantityBefore ?? item.quantity_on_hand);
      const after = Number(result.quantityAfter ?? before);
      const reason = adjustInventory.reason.trim();
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
  function updateQuickAdd<K extends keyof QuickAddState>(key: K, value: QuickAddState[K]) {
    if (key === "category") {
      const nextCategory = value as ProductCategory;
      const total = stockTotal(quickSizeStock) || Number(quickAdd.stock) || 1;
      setQuickSizeStock(current => sizeKindForCategory(nextCategory) === sizeKindForCategory(quickAdd.category)
        ? current
        : sizeKindForCategory(nextCategory) === "one"
          ? { [oneSizeOptions[0]]: Math.max(0, Math.trunc(total)) }
          : {});
      setQuickAdd(current => ({ ...current, category: nextCategory, subcategory: subcategoryList[nextCategory]?.[0] || "" }));
      return;
    }
    setQuickAdd(current => ({ ...current, [key]: value }));
  }
  function addQuickSize(size: string) {
    const key = size.trim().toUpperCase();
    if (!key) return;
    setQuickSizeStock(prev => key in prev ? prev : { ...prev, [key]: 1 });
  }
  function setQuickSizeQty(size: string, quantity: number) {
    const key = size.trim().toUpperCase();
    if (!key) return;
    setQuickSizeStock(prev => ({ ...prev, [key]: Math.max(0, Math.trunc(quantity) || 0) }));
  }
  function removeQuickSize(size: string) {
    const key = size.trim().toUpperCase();
    setQuickSizeStock(prev => { const next = { ...prev }; delete next[key]; return next; });
  }
  async function generateQuickProductCopy() {
    if (!quickAdd.category && !quickAdd.subcategory && !quickAdd.name_cn.trim() && !quickAdd.description_cn.trim() && !quickAdd.notes.trim()) { toast("请先填写分类、商品名或备注。", "err"); return; }
    setAiQuickCopyLoading(true);
    try {
      const sizes = Object.keys(quickSizeStock).length > 0 ? sortSizeKeys(Object.keys(quickSizeStock)).join(",") : quickAdd.sizes;
      const photoHints = [quickMainFile?.name, ...quickBackFiles.map(file => file.name)].filter(Boolean).join(", ");
      const d = await api("/api/admin/generate-product-copy", {
        method: "POST",
        body: JSON.stringify({
          product: {
            name_cn: quickAdd.name_cn,
            description_cn: quickAdd.description_cn,
            category: quickAdd.category,
            subcategory: quickAdd.subcategory,
            color: quickAdd.color,
            brand: quickAdd.brand,
            sizes,
            notes: quickAdd.notes,
            photo_hints: photoHints,
          },
        }),
      }) as TranslationResult & { name_cn?: string; description_cn?: string; material?: string; fit_type?: string; ai_keywords?: string; style_tags?: string };
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
      toast("拍照上新商品资料已生成，保存前可以继续检查。");
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
        const total = stockTotal(sizeStock) || Number(form.stock) || 1;
        setSizeStock(sizeKindForCategory(nextCat) === "one" ? { [oneSizeOptions[0]]: Math.max(0, Math.trunc(total)) } : {});
      }
    }
    setForm(c => {
      if (key === "category") {
        const nextCat = value as ProductCategory;
        const nextSub = subcategoryList[nextCat]?.[0] || "";
        const prefix = skuPrefix(nextCat, nextSub);
        const oldPrefix = skuPrefix(c.category, c.subcategory);
        const skuEmpty = !c.sku.trim() || c.sku === oldPrefix || c.sku.trim() === oldPrefix.replace(/-$/, "");
        return { ...c, category: nextCat, subcategory: nextSub, sku: skuEmpty ? prefix : c.sku };
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
  function loadSizeStock(p: AdminProduct) { const ss = (p as Record<string,unknown>).size_stock; if (ss && typeof ss === 'object' && !Array.isArray(ss)) { const rec: Record<string,number> = {}; for (const [k,v] of Object.entries(ss as Record<string,unknown>)) { if (typeof v === 'number') rec[k.toUpperCase()] = v; } setSizeStock(rec); } else { setSizeStock(sizeKindForCategory(p.category) === "one" ? { [oneSizeOptions[0]]: Math.max(0, Math.trunc(Number(p.stock) || 0)) } : {}); } }
  function formFromProduct(p: AdminProduct): ProductFormData { return { sku:p.sku, name_cn:p.name_cn, name_gr:p.name_gr, name_en:p.name_en, description_cn:p.description_cn, description_gr:p.description_gr, description_en:p.description_en, category:p.category, subcategory:p.subcategory, price:p.price, stock:p.stock, sizes:p.sizes, image_url:p.image_url, image_urls:p.image_urls, brand:p.brand, barcode:p.barcode, vat:p.vat, color:p.color, skroutz_url:p.skroutz_url, is_active:p.is_active, material: p.material || (p as Record<string,unknown>).material as string || "", fit_type: (p as Record<string,unknown>).fit_type as string || "regular", ai_keywords: Array.isArray((p as Record<string,unknown>).ai_keywords) ? ((p as Record<string,unknown>).ai_keywords as string[]).join(",") : String((p as Record<string,unknown>).ai_keywords || ""), style_tags: Array.isArray((p as Record<string,unknown>).style_tags) ? ((p as Record<string,unknown>).style_tags as string[]).join(",") : String((p as Record<string,unknown>).style_tags || ""), size_chart: typeof (p as Record<string,unknown>).size_chart === "object" ? JSON.stringify((p as Record<string,unknown>).size_chart) : String((p as Record<string,unknown>).size_chart || ""), material_verified: (p as Record<string,unknown>).material_verified === true }; }
  function openProductForm(p: AdminProduct) { const nextForm = formFromProduct(p); setEditingId(p.id); setForm(nextForm); loadSizeStock(p); setShowSizeChart(!!nextForm.size_chart.trim()); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); return nextForm; }
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
  function copyProduct(p: AdminProduct) { setEditingId(null); setForm({ ...p, sku: p.sku + "-COPY" }); loadSizeStock(p); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function addSize(sz: string) { setSizeStock(prev => { if (sz in prev) return prev; return { ...prev, [sz]: 0 }; }); }
  function toggleSizeSummary() { setShowSizeSummary(prev => !prev); }
  function addMissingSizes() { const parts = form.sizes.split(/[\/,\s]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean); if (parts.length === 0) { toast("sizes 字段为空", "err"); return; } setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const s of parts) { if (!(s in next)) { next[s] = 0; added++; } } if (added > 0) { toast(`已补充 ${added} 个缺失尺码，已有库存不变`); return next; } toast("所有 sizes 尺码已在库存表中"); return prev; }); }
  function sortSizeKeys(keys: string[]) { return keys.sort((a,b) => { const ai = sizeSortOrder.indexOf(a); const bi = sizeSortOrder.indexOf(b); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.localeCompare(b); }); }
  function addCustomSize() { const raw = prompt("输入尺码名称，多个用逗号分隔", ""); if (!raw) return; const names = raw.split(/[\/,\s]+/).map((x: string) => x.trim().toUpperCase()).filter(Boolean); if (names.length === 0) return; setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const k of names) { if (!(k in next)) { next[k] = 0; added++; } } if (added > 0) { toast(`已添加 ${added} 个尺码`); return next; } toast("所有尺码已存在"); return prev; }); }

  /* ── Translate ────────────────────────────────────────── */
  async function translateProduct() {
    if (!form.name_cn.trim() && !form.description_cn.trim()) { toast("请先填写中文名称或中文描述。", "err"); return; }
    if (form.name_gr || form.description_gr || form.name_en || form.description_en) { setConfirm({ open: true, title: "自动翻译", desc: "当前已有希腊语或英语内容，是否用自动翻译结果覆盖？", confirmText: "覆盖翻译", variant: "danger", action: () => { setConfirm(c => ({ ...c, open: false })); doTranslate(); } }); return; }
    doTranslate();
  }
  async function doTranslate() { setTranslating(true); try { const d = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: form.name_cn, description_cn: form.description_cn }) }) as TranslationResult; setForm(c => ({ ...c, name_gr: d.name_gr, description_gr: d.description_gr, name_en: d.name_en, description_en: d.description_en })); toast("翻译已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "自动翻译失败", "err"); } finally { setTranslating(false); } }
  async function generateProductCopy() {
    if (!form.name_cn.trim() && !form.description_cn.trim() && !form.category && !form.subcategory) { toast("请先填写分类、商品名或备注。", "err"); return; }
    setAiCopyLoading(true);
    try {
      const d = await api("/api/admin/generate-product-copy", {
        method: "POST",
        body: JSON.stringify({
          product: {
            name_cn: form.name_cn,
            description_cn: form.description_cn,
            category: form.category,
            subcategory: form.subcategory,
            color: form.color,
            brand: form.brand,
            material: form.material,
            sizes: form.sizes || sortSizeKeys(Object.keys(sizeStock)).join(","),
          },
        }),
      }) as TranslationResult & { name_cn?: string; description_cn?: string; material?: string; fit_type?: string; ai_keywords?: string; style_tags?: string };
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
      toast("AI 商品文案已生成，请检查后再保存。");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI 文案生成失败", "err");
    } finally {
      setAiCopyLoading(false);
    }
  }
  async function generateAiMeta() { setAiMetaLoading(true); try { const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ product: { name_cn: form.name_cn, name_en: form.name_en, name_gr: form.name_gr, description_en: form.description_en, category: form.category, subcategory: form.subcategory, price: form.price, sizes: form.sizes } }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "生成失败"); setForm(c => ({ ...c, fit_type: d.fit_type || c.fit_type, material: d.material || c.material, ai_keywords: d.ai_keywords || c.ai_keywords, style_tags: d.style_tags || c.style_tags, material_verified: false })); toast("AI 导购信息已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "AI 生成失败", "err"); } finally { setAiMetaLoading(false); } }
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
          const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ product: { name_cn: working.name_cn, name_en: working.name_en, name_gr: working.name_gr, description_en: working.description_en, category: working.category, subcategory: working.subcategory, price: working.price, sizes: working.sizes } }) });
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
          const payload: Record<string, unknown> = { ...product };
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
            const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ product: { name_cn: payload.name_cn, name_en: payload.name_en, name_gr: payload.name_gr, description_en: payload.description_en, category: product.category, subcategory: product.subcategory, price: product.price, sizes: product.sizes } }) });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "AI 导购信息生成失败");
            if (d.fit_type) payload.fit_type = d.fit_type;
            if (!hasText(raw.material) && d.material) payload.material = d.material;
            if (!hasKeywords && d.ai_keywords) payload.ai_keywords = String(d.ai_keywords).split(/[,，\s]+/).filter(Boolean);
            if (!hasStyleTags && d.style_tags) payload.style_tags = String(d.style_tags).split(/[,，\s]+/).filter(Boolean);
            payload.material_verified = false;
          }
          await api(`/api/admin/products/${product.id}`, { method: "PUT", body: JSON.stringify(payload) });
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
  async function doSubmit() { setLoading(true); const p = normalizeProduct(form); const sizeKeys = Object.keys(sizeStock); if (sizeKeys.length === 0) { toast("请先在尺码库存里选择尺码并填写库存", "err"); setLoading(false); return; } const aiData: Record<string, unknown> = {}; if (p.ai_keywords.trim()) aiData.ai_keywords = p.ai_keywords.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean); if (p.style_tags.trim()) aiData.style_tags = p.style_tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean); if (p.size_chart.trim()) aiData.size_chart = JSON.parse(p.size_chart.trim()); if (p.fit_type) aiData.fit_type = p.fit_type; aiData.material_verified = p.material_verified === true; const totalStock = stockTotal(sizeStock); const payload = { ...(p as Record<string,unknown>), ...aiData, sizes: sortSizeKeys(sizeKeys).join(","), size_stock: sizeStock, stock: totalStock }; const url = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products"; const method = editingId ? "PUT" : "POST"; try { const saved = await api(url, { method, body: JSON.stringify(payload) }); toast(editingId ? "商品已更新" : "商品已新增"); if (!editingId && (newMainFile || newGalleryFiles.length > 0)) { const sku = saved?.product?.sku || form.sku; let imgOk = 0; let imgFail = 0; const imgErrors: string[] = []; try { if (newMainFile) { const fd = new FormData(); fd.append("images", newMainFile); fd.append("sku", sku); fd.append("mode", "main"); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: fd }); const d = await r.json(); const results = (d.results||[]) as ApiResult[]; for (const res of results) { if (res.ok) imgOk++; else { imgFail++; if (res.message) imgErrors.push(res.message); } } } if (newGalleryFiles.length > 0) { const fd = new FormData(); newGalleryFiles.forEach(f => fd.append("images", f)); fd.append("sku", sku); fd.append("mode", "gallery"); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: fd }); const d = await r.json(); const results = (d.results||[]) as ApiResult[]; for (const res of results) { if (res.ok) imgOk++; else { imgFail++; if (res.message) imgErrors.push(res.message); } } } if (imgFail > 0) { toast(`商品已保存。图片：成功 ${imgOk}，失败 ${imgFail}${imgErrors.length > 0 ? `（${imgErrors.join("；")}）` : ""}`, "err"); } else { toast("商品已保存，图片已上传"); } } catch { toast("商品已保存，图片上传失败", "err"); } setNewMainFile(null); setNewGalleryFiles([]); } setForm(emptyProduct); setEditingId(null); setSizeStock({}); setTab("dashboard"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "保存失败", "err"); } finally { setLoading(false); } }
  function confirmDeleteProduct(p: AdminProduct) { setConfirm({ open: true, title: "确认下架商品？", desc: `下架 ${p.sku} 后商品将不会在前台显示，但数据会保留，之后可以恢复上架。`, confirmText: "确认下架", variant: "danger", action: () => executeDelete(p) }); }
  async function executeDelete(p: AdminProduct) { setLoading(true); try { await api(`/api/admin/products/${p.id}`, { method: "DELETE" }); toast("商品已下架"); setConfirm(c => ({ ...c, open: false })); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "下架失败", "err"); } finally { setLoading(false); } }
  function confirmRestoreProduct(p: AdminProduct) { setConfirm({ open: true, title: "确认恢复上架？", desc: `恢复上架 ${p.sku} 后商品会重新在前台显示。`, confirmText: "确认恢复", variant: "success", action: () => executeRestore(p) }); }
  async function executeRestore(p: AdminProduct) { setLoading(true); try { await api(`/api/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ ...p, is_active: true }) }); toast("商品已恢复上架"); setConfirm(c => ({ ...c, open: false })); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "恢复失败", "err"); } finally { setLoading(false); } }
  async function permanentDelete(p: AdminProduct) { const input = window.prompt(`永久删除商品 ${p.sku}？\n\n此操作不可恢复！请输入 DELETE 确认：`); if (input !== "DELETE") { if (input !== null) toast("输入错误，已取消", "err"); return; } setLoading(true); try { await api(`/api/admin/products/${p.id}/permanent`, { method: "DELETE" }); toast("商品已永久删除"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "删除失败", "err"); } finally { setLoading(false); } }

  function toggleSelect(id: string) { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function selectAll() { if (selectedIds.size === filteredProducts.slice(0, 100).length) { setSelectedIds(new Set()); } else { setSelectedIds(new Set(filteredProducts.slice(0, 100).map(p => p.id))); } }
  function dismissConfirm() { setConfirm({ open: false, title: "", desc: "", confirmText: "", variant: "default", action: () => {} }); }

  function confirmBatch(isActive: boolean) { const ids = Array.from(selectedIds); if (ids.length === 0) { toast("请先选择商品", "err"); return; } setConfirm({ open: true, title: isActive ? "确认批量恢复上架？" : "确认批量下架？", desc: isActive ? `你将恢复上架选中的 ${ids.length} 个商品。恢复后商品会重新在前台显示。` : `你将下架选中的 ${ids.length} 个商品。下架后商品不会在前台显示，但数据会保留，可后续恢复上架。`, confirmText: isActive ? "确认恢复" : "确认下架", variant: isActive ? "success" : "danger", action: () => executeBatch(isActive, ids) }); }
  async function executeBatch(isActive: boolean, ids: string[]) { const label = isActive ? "恢复上架" : "下架"; setLoading(true); setConfirm(c => ({ ...c, open: true, confirmText: "处理中..." })); try { const r = await fetch("/api/admin/products/bulk", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ ids, is_active: isActive }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "批量操作失败"); toast(`已${label} ${ids.length} 个商品`); setSelectedIds(new Set()); } catch (er) { toast(er instanceof Error ? er.message : `批量${label}失败`, "err"); } finally { setLoading(false); setConfirm({ open: false, title: "", desc: "", confirmText: "", variant: "default", action: () => {} }); } }

  async function batchGenerateAiMeta() { const ids = Array.from(selectedIds); if (ids.length === 0) { toast("请先选择商品", "err"); return; } const targets = products.filter(p => ids.includes(p.id) && (p.name_cn?.trim() || p.name_en?.trim())); const skipped = ids.length - targets.length; setLoading(true); let ok = 0; let fail = 0; for (const p of targets) { try { const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ product: { name_cn: p.name_cn, name_en: p.name_en, name_gr: p.name_gr, description_en: (p as Record<string,unknown>).description_en, category: p.category, subcategory: p.subcategory, price: p.price, sizes: p.sizes } }) }); const d = await r.json(); if (r.ok) { const payload: Record<string, unknown> = {}; if (d.fit_type) payload.fit_type = d.fit_type; if (d.material) payload.material = d.material; payload.material_verified = false; if (d.ai_keywords) { const kw = d.ai_keywords.split(/[,，\s]+/).filter(Boolean); payload.ai_keywords = kw; } if (d.style_tags) { const st = d.style_tags.split(/[,，\s]+/).filter(Boolean); payload.style_tags = st; } await api(`/api/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ ...p, ...payload }) }); ok++; } else { fail++; } } catch { fail++; } } if (skipped > 0) toast(`完成：成功 ${ok}，失败 ${fail}。跳过 ${skipped} 个（无名称）`); else toast(`完成：成功 ${ok}，失败 ${fail}`); setSelectedIds(new Set()); setLoading(false); await loadProducts(); }

  /* ── CSV ──────────────────────────────────────────────── */
  async function handleCsv(f: File | null) { setCsvResults([]); if (!f) { setCsvRows([]); return; } setCsvRows(parseCsv(await f.text())); }
  function confirmImportCsv() { if (csvSummary.needsTranslation > 20) { setConfirm({ open: true, title: "CSV 导入确认", desc: `有 ${csvSummary.needsTranslation} 行需要自动翻译，将调用 DeepSeek API 约 ${Math.ceil(csvSummary.needsTranslation / 3)} 次。是否继续？`, confirmText: "确认导入", variant: "default", action: () => { setConfirm(c => ({ ...c, open: false })); executeImportCsv(); } }); return; } executeImportCsv(); }
  async function executeImportCsv() { setLoading(true); try { const d = await api("/api/admin/products/import", { method: "POST", body: JSON.stringify({ rows: csvRows }) }); setCsvResults(d.results||[]); toast(`CSV 导入完成：成功 ${d.successCount}，失败 ${d.failureCount}${d.translatedCount>0?`，翻译成功 ${d.translatedCount}`:""}${d.translateFailureCount>0?`，翻译失败 ${d.translateFailureCount}`:""}`); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "CSV 导入失败", "err"); } finally { setLoading(false); } }

  /* ── Image upload ──────────────────────────────────────── */
  async function uploadImages(files: FileList | null, opts: ImageUploadOptions = {}) { setImageResults([]); if (!files || files.length === 0) return; if (opts.sku && !opts.mode) { toast("请选择上传类型。", "err"); return; } try { setLoading(true); const body = new FormData(); Array.from(files).forEach(f => body.append("images", f)); if (opts.sku) body.append("sku", opts.sku); if (opts.mode) body.append("mode", opts.mode); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body }); const d = await readJson(r, "图片上传接口错误"); if (!r.ok) throw new Error(d.error || "图片上传失败"); setImageResults(d.results||[]); const okCount = (d.results||[]).filter((r: ApiResult) => r.ok).length; const failCount = (d.results||[]).filter((r: ApiResult) => !r.ok).length; const failReasons = (d.results||[]).filter((r: ApiResult) => !r.ok).map((r: ApiResult) => r.message).filter(Boolean); const summary = failReasons.length > 0 ? `失败原因：${failReasons.join("；")}` : ""; toast(`图片处理完成：成功 ${okCount}，失败 ${failCount}${summary ? `。${summary}` : ""}`); syncFormAfterUpload(opts, d); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "图片上传失败", "err"); } finally { setLoading(false); } }
  function syncFormAfterUpload(opts: ImageUploadOptions, d: Record<string, unknown>) { if (!editingIdRef.current || form.sku !== opts.sku) return; const results = (d.results || []) as ApiResult[]; if (opts.mode === "main" && results.length > 0 && results[0].imageUrl) { setForm(c => ({ ...c, image_url: results[0].imageUrl! })); } else if (opts.mode === "gallery" && results.length > 0) { const newUrls = results.filter(r => r.ok && r.imageUrl).map(r => r.imageUrl!); if (newUrls.length > 0) { setForm(c => { const existing = imageLines(c.image_urls); const seen = new Set([c.image_url.trim(), ...existing]); const toAdd = newUrls.filter(u => !seen.has(u)); return toAdd.length > 0 ? { ...c, image_urls: [...existing, ...toAdd].join("\n") } : c; }); } } }
  function confirmDeleteImage(opts: ImageDeleteOptions) { const label = opts.kind === "main" ? "主图" : "这张多图"; setConfirm({ open: true, title: `确定删除${label}？`, desc: "Storage 文件也会一起删除。", confirmText: "确认删除", variant: "danger", action: () => { setConfirm(c => ({ ...c, open: false })); executeDeleteImage(opts, label); } }); }
  async function executeDeleteImage(opts: ImageDeleteOptions, label: string) { setLoading(true); try { const r = await fetch("/api/admin/images", { method: "DELETE", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify(opts) }); const d = await readJson(r, "删除图片接口错误"); if (!r.ok) throw new Error(d.error || "删除图片失败"); toast(`${label}已删除。`); await loadProducts(); if (editingIdRef.current && form.sku === opts.sku) { setForm(c => { if (opts.kind === "main") return { ...c, image_url: "" }; const next = imageLines(c.image_urls).filter((_, i) => i !== opts.index); return { ...c, image_urls: next.join("\n") }; }); } } catch (er) { toast(er instanceof Error ? er.message : "删除图片失败", "err"); } finally { setLoading(false); } }

  async function submitQuickAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quickMainFile) { toast("请先拍摄或选择一张主图", "err"); return; }
    if (!Number.isFinite(Number(quickAdd.price)) || Number(quickAdd.price) <= 0) { toast("请填写正确价格", "err"); return; }
    const sku = quickSku();
    const parsedSizeStock = Object.keys(quickSizeStock).length > 0 ? quickSizeStock : parseSizeStockText(quickAdd.size_stock);
    const sizeKeys = Object.keys(parsedSizeStock);
    if (sizeKeys.length === 0) { toast("请先选择尺码并填写库存", "err"); return; }
    const stock = sizeKeys.reduce((sum, key) => sum + parsedSizeStock[key], 0);
    const payload: Record<string, unknown> = {
      sku,
      category: quickAdd.category,
      subcategory: quickAdd.subcategory,
      price: Number(quickAdd.price),
      stock,
      sizes: sortSizeKeys(sizeKeys).join(","),
      size_stock: parsedSizeStock,
      name_cn: quickAdd.name_cn.trim() || `${quickAdd.color ? `${quickAdd.color} ` : ""}${quickAdd.category} ${quickAdd.subcategory}`,
      description_cn: quickAdd.description_cn.trim() || quickAdd.notes.trim() || "请在保存后检查并补充商品描述。",
      name_en: quickAdd.name_en.trim(),
      name_gr: quickAdd.name_gr.trim(),
      description_en: quickAdd.description_en.trim(),
      description_gr: quickAdd.description_gr.trim(),
      brand: quickAdd.brand.trim(),
      color: quickAdd.color.trim(),
      vat: 24,
      image_url: "",
      image_urls: "",
      is_active: quickAdd.is_active,
      fit_type: quickAdd.fit_type || "regular",
      material: quickAdd.material.trim(),
      ai_keywords: quickAdd.ai_keywords.trim() ? quickAdd.ai_keywords.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) : [],
      style_tags: quickAdd.style_tags.trim() ? quickAdd.style_tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) : [],
      material_verified: false,
    };
    setQuickSaving(true);
    try {
      const saved = await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
      const savedSku = saved?.product?.sku || sku;
      const main = new FormData();
      main.append("images", quickMainFile);
      main.append("sku", savedSku);
      main.append("mode", "main");
      const mainResult = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: main });
      const mainData = await readJson(mainResult, "主图上传失败");
      if (!mainResult.ok) throw new Error(mainData.error || "主图上传失败");
      if (quickBackFiles.length > 0) {
        const gallery = new FormData();
        quickBackFiles.forEach(file => gallery.append("images", file));
        gallery.append("sku", savedSku);
        gallery.append("mode", "gallery");
        const galleryResult = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: gallery });
        const galleryData = await readJson(galleryResult, "多图上传失败");
        if (!galleryResult.ok) throw new Error(galleryData.error || "多图上传失败");
      }
      toast(`快速上新完成：${savedSku}`);
      setQuickAdd(emptyQuickAdd);
      setQuickSizeStock({});
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
    setSellingSku(`${product.sku}:${size || ""}`);
    try {
      const clientRequestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `quick-sale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api("/api/admin/products/sell", {
        method: "POST",
        body: JSON.stringify({ sku: product.sku, size, quantity: 1, autoDeactivate: true, clientRequestId }),
      });
      if (result.erpSyncWarning) {
        toast(`旧库存已更新，但 ERP 库存同步需要检查：${result.erpSyncWarning}`, "err");
      } else if (result.alreadyProcessed) {
        toast("这次售出请求已经处理过，没有重复扣库存。");
      }
      toast(size ? `${product.sku} / ${size} 已售出 1 件` : `${product.sku} 已售出 1 件`);
      await loadProducts();
    } catch (er) {
      toast(er instanceof Error ? er.message : "减库存失败", "err");
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
      toast("AI 模特图已生成，并加入多图。");
      await loadProducts();
    } catch (er) {
      toast(er instanceof Error ? er.message : "AI 模特图生成失败", "err");
    } finally {
      setStyleImageSku(null);
    }
  }

  /* ── Login gate ─────────────────────────────────────────── */
  if (!activePassword) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-[#fbfaf6] via-white to-stone-100 flex items-center justify-center px-4 py-10">
        <section className="w-full max-w-sm rounded-3xl border border-stone-200/80 bg-white p-8 text-center shadow-xl shadow-stone-900/10">
          <div className="mb-6">
            <svg className="mx-auto h-10 w-10 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
          <h1 className="text-xl font-black text-ink">商品管理后台</h1>
          <p className="mt-2 text-sm text-stone-500">Fashion Store Admin</p>
          <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); setActivePassword(password); }}>
            <input className="input text-center" onChange={e => setPassword(e.target.value)} type="password" value={password} placeholder="管理密码" />
            <button className="w-full rounded-full bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800">登录</button>
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
        <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-stone-200/80 bg-white/95 p-4 shadow-sm shadow-stone-900/5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h1 className="text-2xl font-black text-ink">商品管理后台</h1>
            <p className="text-xs text-stone-400">管理商品、图片、库存、CSV 导入和 Skroutz Feed</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" href="/admin/settings">店铺设置</a>
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => { fetch("/api/admin/backup", { headers: { "x-admin-password": activePassword } }).then(r => r.blob()).then(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `products-export-${new Date().toISOString().split("T")[0]}.csv`; a.click(); }).catch(() => toast("备份下载失败", "err")); }} type="button">导出 CSV</button>
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => { setActivePassword(""); setPassword(""); }}>退出</button>
          </div>
        </header>

        {/* ── Stats cards ────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[{ label: "商品总数", v: stats.total, color: "bg-stone-500" }, { label: "已上架", v: stats.active, color: "bg-emerald-500" }, { label: "缺图片", v: stats.noImage, color: "bg-amber-400" }, { label: "库存为0", v: stats.noStock, color: "bg-rose-400" }, { label: "未分尺码", v: stats.noSizeStock, color: "bg-violet-400" }, { label: "分类数", v: stats.categories, color: "bg-sky-400" }].map(s => (
            <div key={s.label} className="relative overflow-hidden rounded-2xl border border-stone-200/70 bg-white p-4 shadow-sm shadow-stone-900/5">
              <div className={`absolute top-0 left-0 w-1 h-full ${s.color} rounded-l-full`} />
              <p className="text-2xl font-black text-ink">{s.v}</p>
              <p className="mt-0.5 text-[11px] font-bold text-stone-400">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab bar ─────────────────────────────────────── */}
        <nav className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="rounded-2xl border border-stone-200/70 bg-white/95 p-2 shadow-sm shadow-stone-900/5">
            <p className="px-2 pb-1 text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">常用操作</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {primaryTabKeys.map(key => (
                <button
                  key={key}
                  className={`min-h-12 rounded-lg px-4 py-3 text-sm font-black transition sm:min-h-0 sm:py-2.5 ${tab === key ? "bg-ink text-white shadow-sm" : "bg-stone-50 text-ink hover:bg-stone-100"}`}
                  onClick={() => setTab(key)}
                  type="button"
                >
                  {tabLabelByKey.get(key) || key}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-stone-200/70 bg-white/95 p-2 shadow-sm shadow-stone-900/5">
            <p className="px-2 pb-1 text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">管理工具</p>
            <div className="flex gap-1 overflow-x-auto">
              {managementTabKeys.map(key => (
                <button
                  key={key}
                  className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-bold transition ${key === "csv" || key === "skroutz" ? "hidden lg:inline-flex" : ""} ${tab === key ? "bg-ink text-white shadow-sm" : "text-stone-500 hover:bg-stone-100 hover:text-ink"}`}
                  onClick={() => setTab(key)}
                  type="button"
                >
                  {tabLabelByKey.get(key) || key}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* ── TAB: Launch check ─────────────────────────────── */}
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
                <Field label="一级分类"><select className="input" value={quickAdd.category} onChange={e => updateQuickAdd("category", e.target.value as ProductCategory)}>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" value={quickAdd.subcategory} onChange={e => updateQuickAdd("subcategory", e.target.value)}>{subcategoryList[quickAdd.category].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
                <Field label="价格"><input className="input" min="0" step="0.01" type="number" value={quickAdd.price} onChange={e => updateQuickAdd("price", Number(e.target.value))} /></Field>
                <Field label="总库存"><div><input className="input bg-stone-50 text-stone-500 cursor-not-allowed" min="0" step="1" type="number" value={stockTotal(quickSizeStock)} readOnly /><p className="mt-1 text-[10px] text-stone-400">由尺码库存自动计算，不能手动填写</p></div></Field>
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="text-sm font-bold text-ink">尺码库存</label>
                  <div className="mt-2 rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
                    <div className="mb-3 flex flex-wrap gap-2">
                      {sizeOptionsForCategory(quickAdd.category).map(size => (
                        <button className="min-h-10 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-ink shadow-sm shadow-stone-900/5 hover:bg-stone-100" key={size} onClick={() => addQuickSize(size)} type="button">+ {size}</button>
                      ))}
                    </div>
                    {Object.keys(quickSizeStock).length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {sortSizeKeys(Object.keys(quickSizeStock)).map(size => (
                          <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm shadow-stone-900/5" key={size}>
                            <span className="w-12 text-sm font-black text-ink">{size}</span>
                            <button className="h-9 w-9 rounded-lg border border-stone-200 text-sm font-black hover:bg-stone-50" onClick={() => setQuickSizeQty(size, quickSizeStock[size] - 1)} type="button">-</button>
                            <input className="h-8 w-16 rounded border border-stone-200 text-center text-base sm:text-sm" min="0" step="1" type="number" value={quickSizeStock[size]} onChange={e => setQuickSizeQty(size, Number(e.target.value))} />
                            <button className="h-9 w-9 rounded-lg border border-stone-200 text-sm font-black hover:bg-stone-50" onClick={() => setQuickSizeQty(size, quickSizeStock[size] + 1)} type="button">+</button>
                            {sizeKindForCategory(quickAdd.category) !== "one" ? <button className="ml-auto text-xs font-bold text-red-500" onClick={() => removeQuickSize(size)} type="button">删除</button> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500">请先选择尺码并填写库存。首饰、包包、行李箱和其他类默认使用 ONE SIZE。</p>
                    )}
                    <p className="mt-2 text-xs text-stone-400">已分配库存：{stockTotal(quickSizeStock)}。保存时会自动同步总库存和 sizes。</p>
                  </div>
                </div>
                <Field label="颜色（选填）"><input className="input" value={quickAdd.color} onChange={e => updateQuickAdd("color", e.target.value)} placeholder="black / beige" /></Field>
                <Field label="品牌（选填）"><input className="input" value={quickAdd.brand} onChange={e => updateQuickAdd("brand", e.target.value)} /></Field>
                <Field label="状态"><select className="input" value={quickAdd.is_active ? "yes" : "no"} onChange={e => updateQuickAdd("is_active", e.target.value === "yes")}><option value="yes">保存后上架</option><option value="no">先存草稿</option></select></Field>
                <Field label="中文商品名（可空）"><input className="input" value={quickAdd.name_cn} onChange={e => updateQuickAdd("name_cn", e.target.value)} placeholder="可后续 AI 补全" /></Field>
                <Field label="备注 / 描述（可空）"><textarea className="input min-h-24" value={quickAdd.description_cn} onChange={e => { updateQuickAdd("description_cn", e.target.value); updateQuickAdd("notes", e.target.value); }} placeholder="例如：薄款、适合夏天、宽松版型" /></Field>
                <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-violet-100 bg-violet-50/70 p-4 shadow-sm shadow-violet-950/5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-ink">AI 一键生成商品资料</p>
                      <p className="mt-1 text-xs text-stone-500">根据分类、颜色、品牌、尺码、备注和图片文件名生成文案、材质、版型、关键词和风格标签。</p>
                    </div>
                    <button className="min-h-11 w-full rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-black text-violet-700 shadow-sm shadow-violet-950/5 hover:bg-violet-100 disabled:opacity-50 sm:w-auto sm:text-xs" disabled={aiQuickCopyLoading} onClick={() => void generateQuickProductCopy()} type="button">{aiQuickCopyLoading ? "生成中..." : "AI 生成商品资料"}</button>
                  </div>
                  {quickAdd.name_en || quickAdd.name_gr || quickAdd.description_en || quickAdd.description_gr || quickAdd.material || quickAdd.ai_keywords || quickAdd.style_tags ? (
                    <div className="mt-3 grid gap-2 text-xs text-stone-600 md:grid-cols-2">
                      <p><b>EN:</b> {quickAdd.name_en || "-"} {quickAdd.description_en ? `- ${quickAdd.description_en}` : ""}</p>
                      <p><b>EL:</b> {quickAdd.name_gr || "-"} {quickAdd.description_gr ? `- ${quickAdd.description_gr}` : ""}</p>
                      <p><b>材质/版型:</b> {quickAdd.material || "-"} / {quickAdd.fit_type || "regular"}</p>
                      <p><b>关键词/标签:</b> {quickAdd.ai_keywords || "-"} {quickAdd.style_tags ? ` / ${quickAdd.style_tags}` : ""}</p>
                    </div>
                  ) : null}
                </div>
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
                <p className="mt-3 text-[11px] leading-relaxed text-stone-400">提示：不需要打印 SKU 标签。后台自动生成 SKU；实体店卖掉后用“快速售出”减库存。</p>
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
              <select className="input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部分类</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select>
              <select className="input" value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat && isProductCategory(filterCat) ? subcategoryList[filterCat].map(s => <option key={s} value={s}>{s}</option>) : null}</select>
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
                  <h2 className="mt-1 text-xl font-black text-ink">POS 收银</h2>
                  <p className="mt-1 text-xs text-stone-500">扫码枪输入条码后按 Enter，可快速搜索并加入购物车；完成收银前会先预检库存。</p>
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
                <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700">{posMessage}</p>
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
                            {disabled ? "库存不足 / 已停用" : "加入购物车"}
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
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Cart</p>
                  <h3 className="mt-1 text-lg font-black text-ink">购物车</h3>
                </div>
                <button
                  className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50 disabled:opacity-40"
                  disabled={posCart.length === 0 || posCheckoutLoading}
                  onClick={() => {
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
                    购物车为空。
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                <div className="space-y-2 text-sm font-bold text-stone-600">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatEuro(posSubtotal)}</span></div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Discount</span>
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
                  <div className="flex justify-between border-t border-stone-200 pt-3 text-lg font-black text-ink"><span>Total</span><span>{formatEuro(posTotal)}</span></div>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-stone-400">付款方式</p>
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
                  <button
                    className="mb-3 min-h-10 rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                    disabled={posReceiptLoading}
                    onClick={() => posLastOrder.order?.id ? void openPosReceipt(posLastOrder.order.id) : undefined}
                    type="button"
                  >
                    {posReceiptLoading ? "读取小票..." : "查看 / 打印小票"}
                  </button>
                  <p className="font-black">{posLastOrder.alreadyProcessed ? "订单已处理" : "收银完成"}</p>
                  <p className="mt-1 font-bold">订单号：{posLastOrder.order.order_number}</p>
                  <p className="font-bold">金额：{formatEuro(Number(posLastOrder.order.total || 0))}</p>
                  <p className="font-bold">付款：{posLastOrder.payments?.[0]?.method || posPaymentMethod}</p>
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
                  {posCheckoutLoading ? "处理中..." : "预检订单"}
                </button>
                <button
                  className="min-h-12 rounded-xl bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50"
                  disabled={posCheckoutLoading || posCart.length === 0}
                  onClick={() => void confirmPosCheckout()}
                  type="button"
                >
                  完成收银并扣库存
                </button>
              </div>

              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-700">
                提醒：真实收银会创建订单并扣减 ERP 库存。首次验证请使用测试商品。
              </p>
            </aside>
          </section>
        ) : null}

        {tab === "posOrders" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">POS Orders</p>
                  <h2 className="mt-1 text-xl font-black text-ink">POS 订单历史</h2>
                  <p className="mt-1 text-xs text-stone-500">只读查看 POS 订单、付款、商品明细和库存流水。本页不会作废、退款或修改库存。</p>
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
                  <option value="completed">completed</option>
                  <option value="voided">voided</option>
                  <option value="refunded">refunded</option>
                </select>
                <select className="input" value={posOrderPaymentMethod} onChange={e => setPosOrderPaymentMethod(e.target.value as PosPaymentFilter)}>
                  <option value="all">全部付款</option>
                  <option value="cash">cash</option>
                  <option value="card">card</option>
                  <option value="other">other</option>
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
                        <td className="px-4 py-3 font-bold text-stone-700">{order.payment_method || "-"}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">{order.payment_status}</span></td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${order.status === "completed" ? "bg-emerald-50 text-emerald-700" : order.status === "voided" ? "bg-stone-100 text-stone-600" : "bg-amber-50 text-amber-700"}`}>{order.status}</span></td>
                        <td className="px-4 py-3 font-bold text-stone-700">{order.items_count}</td>
                        <td className="px-4 py-3 text-xs font-bold text-stone-500">{order.created_by || "-"}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => void loadPosOrderDetail(order.id)} type="button">查看详情</button>
                            {order.status === "completed" ? (
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
                      {posOrderDetail.order.status === "completed" ? (
                        <button
                          className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 hover:bg-red-100"
                          onClick={() => openPosVoidDialog(posOrderDetail.order)}
                          type="button"
                        >
                          作废订单
                        </button>
                      ) : null}
                      <button
                        className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                        disabled={posReceiptLoading}
                        onClick={() => void openPosReceipt(posOrderDetail.order.id)}
                        type="button"
                      >
                        {posReceiptLoading ? "读取小票..." : "查看 / 打印小票"}
                      </button>
                      <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setPosOrderDetail(null)} type="button">关闭</button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">订单状态</p>
                      <p className="mt-1 text-lg font-black text-ink">{posOrderDetail.order.status}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">支付状态</p>
                      <p className="mt-1 text-lg font-black text-ink">{posOrderDetail.order.payment_status}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-bold text-stone-400">付款方式</p>
                      <p className="mt-1 text-lg font-black text-ink">{posOrderDetail.payments[0]?.method || "-"}</p>
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
                      onClick={() => setPosVoidDialog(null)}
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
                  <p className="mt-1 text-xs text-stone-500">只管理 ERP 库存记录；前台和 Skroutz Feed 仍继续读取旧库存字段。</p>
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
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                建议先用测试 SKU 验证库存调整流程，确认流水、对账和前台库存都正常后，再处理真实商品。
              </div>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-stone-400">当前筛选结果统计</p>
              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
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
              <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px_150px_150px_150px_auto_auto_auto]">
                <input className="input" placeholder="搜索商品名 / SKU / variant SKU / barcode" value={inventoryQ} onChange={e => setInventoryQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadInventoryData(); }} />
                <input className="input" placeholder="尺码，如 S / 38" value={inventorySize} onChange={e => setInventorySize(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadInventoryData(); }} />
                <select className="input" value={inventoryStatus} onChange={e => setInventoryStatus(e.target.value as InventoryStatusFilter)}><option value="all">全部状态</option><option value="normal">正常</option><option value="low_stock">低库存</option><option value="out_of_stock">缺货</option><option value="inactive">停用</option><option value="mismatch">对账异常</option></select>
                <select className="input" value={inventorySort} onChange={e => setInventorySort(e.target.value as InventorySort)}><option value="stock_asc">库存从低到高</option><option value="stock_desc">库存从高到低</option><option value="sku">SKU</option></select>
                <select className="input" value={lowStockThreshold} onChange={e => setLowStockThreshold(Math.max(1, Math.trunc(Number(e.target.value) || 3)))}><option value={1}>低库存 ≤ 1</option><option value={2}>低库存 ≤ 2</option><option value={3}>低库存 ≤ 3</option><option value={5}>低库存 ≤ 5</option><option value={10}>低库存 ≤ 10</option></select>
                <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadInventoryData()} type="button">搜索</button>
                <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50" disabled={filteredInventoryItems.length === 0} onClick={downloadInventoryCsv} type="button">导出库存 CSV</button>
              </div>
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-base font-black text-ink">库存总览</h3>
                  <p className="text-xs text-stone-500">当前筛选结果 {filteredInventoryItems.length} 个 variant。上方统计只代表当前筛选结果，不是全库统计。调整库存会写 ERP 流水，并同步回旧库存字段。</p>
                </div>
                {inventoryLoading ? <p className="text-xs font-bold text-stone-400">加载中...</p> : null}
              </div>
              {filteredInventoryItems.length === 0 && !inventoryLoading ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">暂无库存数据</p> : null}
              <div className="overflow-x-auto rounded-2xl border border-stone-200">
                <table className="min-w-[1120px] w-full text-left text-sm">
                  <thead className="bg-stone-50 text-stone-500">
                    <tr>
                      <th className="px-3 py-2 text-xs font-black">商品</th>
                      <th className="px-3 py-2 text-xs font-black">Product SKU</th>
                      <th className="px-3 py-2 text-xs font-black">Variant SKU</th>
                      <th className="px-3 py-2 text-xs font-black">尺码</th>
                      <th className="px-3 py-2 text-xs font-black">颜色</th>
                      <th className="px-3 py-2 text-xs font-black">Barcode</th>
                      <th className="px-3 py-2 text-right text-xs font-black">现有</th>
                      <th className="px-3 py-2 text-right text-xs font-black">预留</th>
                      <th className="px-3 py-2 text-right text-xs font-black">可用</th>
                      <th className="px-3 py-2 text-xs font-black">状态</th>
                      <th className="px-3 py-2 text-xs font-black">对账</th>
                      <th className="px-3 py-2 text-right text-xs font-black">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventoryItems.map(item => {
                      const reconciled = item.stock_matches_legacy && item.size_stock_matches_legacy;
                      const stockStatus = inventoryStatusFor(item, lowStockThreshold);
                      return (
                        <tr className="border-t border-stone-100 bg-white align-top" key={item.variant_id}>
                          <td className="max-w-[220px] px-3 py-3"><p className="line-clamp-2 font-black text-ink">{item.product_name || "-"}</p></td>
                          <td className="px-3 py-3 font-mono text-xs font-bold text-stone-600">{item.product_sku || "-"}</td>
                          <td className="px-3 py-3 font-mono text-xs font-bold text-stone-600">{item.variant_sku || "-"}</td>
                          <td className="px-3 py-3 text-xs font-bold">{item.size || "-"}</td>
                          <td className="px-3 py-3 text-xs">{item.color || "-"}</td>
                          <td className="px-3 py-3 font-mono text-xs">{item.barcode || "-"}</td>
                          <td className="px-3 py-3 text-right text-sm font-black text-ink">{item.quantity_on_hand}</td>
                          <td className="px-3 py-3 text-right text-sm font-bold text-stone-500">{item.quantity_reserved}</td>
                          <td className={`px-3 py-3 text-right text-sm font-black ${item.quantity_available <= 0 ? "text-red-600" : item.quantity_available <= lowStockThreshold ? "text-amber-600" : "text-emerald-700"}`}>{item.quantity_available}</td>
                          <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${stockStatus.className}`}>{stockStatus.label}</span></td>
                          <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${reconciled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{reconciled ? "正常" : "异常"}</span></td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button className="rounded-lg bg-ink px-3 py-2 text-xs font-black text-white hover:bg-stone-800" onClick={() => openInventoryAdjust(item)} type="button">调整库存</button>
                              <button className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-black text-ink hover:bg-stone-50" onClick={() => { setMovementVariantId(item.variant_id); void loadInventoryMovements(item.variant_id); }} type="button">查看流水</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                </select>
                <select className="input" value={movementSourceType} onChange={e => setMovementSourceType(e.target.value)}>
                  <option value="">全部来源</option>
                  <option value="quick_sell">quick_sell</option>
                  <option value="admin_create">admin_create</option>
                  <option value="admin_edit">admin_edit</option>
                  <option value="csv_import">csv_import</option>
                  <option value="admin_inventory_adjustment">admin_inventory_adjustment</option>
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
                    <button className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-black text-stone-500 hover:bg-stone-50" onClick={() => setAdjustInventory({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" })} type="button">关闭</button>
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
                    <button className="min-h-11 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50" onClick={() => setAdjustInventory({ item: null, mode: "set_to", quantity: "", reason: "", submitting: false, message: "" })} type="button">取消</button>
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
                  <p className="mt-1 text-xs text-stone-500">只读检查，不会修改商品。用于判断商品是否适合前台展示和进入 Skroutz Feed。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50" disabled={loading} onClick={() => void loadProducts()} type="button">刷新检查</button>
                  <button className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={loading || launchChecks.aiCompletable === 0} onClick={confirmBatchAiComplete} type="button">批量 AI 补全</button>
                  <button className="rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-50" disabled={launchChecks.issueCount === 0} onClick={downloadLaunchCheckReport} type="button">导出检查报告</button>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-7">
                {[
                  { label: "商品总数", value: products.length, tone: "text-ink" },
                  { label: "可前台展示", value: launchChecks.siteReady, tone: "text-emerald-700" },
                  { label: "可进 Skroutz", value: launchChecks.feedReady, tone: "text-blue-700" },
                  { label: "图片待处理", value: launchChecks.imageIssues, tone: launchChecks.imageIssues > 0 ? "text-amber-600" : "text-emerald-700" },
                  { label: "可 AI 补全", value: launchChecks.aiCompletable, tone: launchChecks.aiCompletable > 0 ? "text-violet-700" : "text-emerald-700" },
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
                  <p className="mt-1 text-xs text-stone-500">阻断问题会影响上架或进入 Feed；优化项不会阻断展示，但建议补齐。</p>
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
                          <p className="mt-1 text-[11px] font-bold text-stone-400">{product.category || "无分类"} / {product.subcategory || "无二级分类"}</p>
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
                        <button className="min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={autoCompletingId === product.id} onClick={() => void startAiComplete(product)} type="button">
                          {autoCompletingId === product.id ? "补全中..." : "AI 补全"}
                        </button>
                        {issues.some(issue => issue.code === "image" || issue.code === "image-quality") ? (
                          <button className="min-h-11 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100" onClick={() => handleIssueAction(product, "image")} type="button">重新上传主图</button>
                        ) : null}
                      </div>
                      <p className={`mt-3 text-[11px] font-black ${feedReady ? "text-blue-700" : "text-stone-400"}`}>
                        {feedReady ? "当前会进入 Skroutz Feed" : "当前不会进入 Skroutz Feed"}
                      </p>
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
                      <th className="py-2.5 pr-3">Feed</th>
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
                            <p className="mt-1 text-[11px] text-stone-400">{product.category || "无分类"} / {product.subcategory || "无二级分类"}</p>
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
                          <td className="py-3 pr-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${feedReady ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-500"}`}>
                              {feedReady ? "会进入" : "不会进入"}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex flex-wrap gap-1.5">
                              <button className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => startEdit(product)} type="button">编辑</button>
                              <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={autoCompletingId === product.id} onClick={() => void startAiComplete(product)} type="button">
                                {autoCompletingId === product.id ? "补全中..." : "AI 补全"}
                              </button>
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
            <details className="mb-4 group">
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
                  { label: "Skroutz Feed", ok: true, hint: "在店铺设置中开启" },
                ]; return items.map((it, i) => (<div key={i} className="flex items-center gap-2"><span className={it.ok ? "text-green-600" : "text-amber-600"}>{it.ok ? "✓" : "○"}</span><span className="text-stone-600">{it.label}</span>{!it.ok && it.hint ? <span className="text-amber-600">— {it.hint}</span> : null}</div>)); })()}
              </div>
            </details>
            {/* Search bar */}
            <div className="mb-4 grid gap-3 md:grid-cols-5">
              <input className="input md:col-span-2" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部分类</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select>
              <select className="input" value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat && isProductCategory(filterCat) ? subcategoryList[filterCat].map(s => <option key={s} value={s}>{s}</option>) : null}</select>
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
            {selectedIds.size > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-4 py-2 text-sm">
                <span className="text-xs font-bold text-stone-600">已选择 {selectedIds.size} 个商品</span>
                <button className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50" onClick={() => confirmBatch(false)}>批量下架</button>
                <button className="rounded-lg border border-green-100 px-3 py-1.5 text-xs font-bold text-green-700 hover:bg-green-50" onClick={() => confirmBatch(true)}>批量恢复上架</button>
                <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100" onClick={() => batchGenerateAiMeta()} type="button">批量生成 AI 导购</button>
                <button className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-400 hover:bg-stone-100" onClick={() => setSelectedIds(new Set())}>取消选择</button>
              </div>
            ) : null}

            {/* Mobile product cards */}
            <div className="grid gap-3 lg:hidden">
              {filteredProducts.slice(0, 100).map(p => (
                <article className="rounded-2xl border border-stone-200/80 bg-white p-3 shadow-sm shadow-stone-900/5" key={p.id}>
                  <div className="flex gap-3">
                    <label className="pt-1">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                    </label>
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
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-500">{p.category}/{p.subcategory}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"}`}>{p.is_active ? "上架" : "下架"}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-base font-black text-terracotta">€{Number(p.price).toFixed(2)}</p>
                        <p className="rounded-full bg-stone-50 px-2 py-1 text-[11px] font-bold text-stone-600">库存 {effectiveStock(p)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50" onClick={() => startEdit(p)} type="button">编辑</button>
                    <button className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50" onClick={() => copyProduct(p)} type="button">复制</button>
                    {p.is_active ? (
                      <button className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-600 hover:bg-red-100" onClick={() => confirmDeleteProduct(p)} type="button">下架</button>
                    ) : (
                      <button className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs font-black text-green-700 hover:bg-green-100" onClick={() => confirmRestoreProduct(p)} type="button">上架</button>
                    )}
                  </div>
                  {!p.is_active ? (
                    <button className="mt-2 w-full rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-50" onClick={() => void permanentDelete(p)} type="button">永久删除</button>
                  ) : null}
                </article>
              ))}
              {filteredProducts.length === 0 ? <p className="py-10 text-center text-sm text-stone-400">没有匹配的商品</p> : null}
              {filteredProducts.length > 100 ? <p className="py-3 text-center text-xs text-stone-400">显示前 100 条，使用搜索筛选查看更多</p> : null}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
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
                      <td className="py-2 pr-3"><span className="inline-block rounded bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-500">{p.category}/{p.subcategory}</span></td>
                      <td className="py-2 pr-3 text-sm font-bold">€{Number(p.price).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-sm">{effectiveStock(p)}</td>
                      <td className="py-2 pr-3"><div className="flex flex-col gap-1"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${p.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"}`}>{p.is_active ? "上架" : "下架"}</span>{(() => { const raw = p as Record<string,unknown>; const w = Number(raw.image_width) || 0; const h = Number(raw.image_height) || 0; const hasImgUrl = p.image_url?.trim(); const skrOk = hasImgUrl && (w >= 1000 || h >= 1000); if (hasImgUrl && !skrOk) return <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 cursor-help" title={`主图 ${w}×${h} 不满足 Skroutz 最低要求（至少一边 ≥ 1000px）`}>Skroutz 图片不符</span>; return null; })()}{(() => { const raw = p as Record<string,unknown>; const hasNameEn = p.name_en?.trim() || p.name_gr?.trim(); const hasPrice = Number(p.price) > 0; const hasImg = p.image_url?.trim(); const isClothing = /women|men/i.test(p.category); const isShoes = p.category === "shoes"; const needsSizes = isClothing || isShoes; const hasSzChart = raw.size_chart && typeof raw.size_chart === "object" && Object.keys(raw.size_chart as object).length > 0; const hasSizes = p.sizes?.trim(); const hasKeywords = (Array.isArray(raw.ai_keywords) && (raw.ai_keywords as unknown[]).length > 0) || (typeof raw.ai_keywords === "string" && (raw.ai_keywords as string).trim()); const hasStyleTags = (Array.isArray(raw.style_tags) && (raw.style_tags as unknown[]).length > 0) || (typeof raw.style_tags === "string" && (raw.style_tags as string).trim()); const matOk = !raw.material || !String(raw.material).trim() || raw.material_verified === true; const sizesOk = !needsSizes || hasSzChart || hasSizes; const basicsOk = hasNameEn && hasImg && hasPrice && p.is_active && effectiveStock(p) > 0; const enhancedOk = hasKeywords && hasStyleTags && matOk; const missing: string[] = []; if (!hasKeywords) missing.push("AI关键词"); if (!hasStyleTags) missing.push("风格标签"); if (!matOk) missing.push("材质确认"); if (needsSizes && !hasSzChart && !hasSizes) missing.push("尺码信息"); if (!basicsOk) missing.push("基础信息"); const level = basicsOk ? (enhancedOk && sizesOk ? "complete" : "usable") : "incomplete"; const colors = { complete: "bg-green-100 text-green-700", usable: "bg-blue-100 text-blue-700", incomplete: "bg-amber-100 text-amber-700" }; const labels = { complete: "AI完整", usable: "AI可用", incomplete: "AI需补充" }; const tip = missing.length > 0 ? missing.join("、") : "AI导购信息齐全"; return <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap cursor-help ${colors[level as keyof typeof colors]}`} title={`${tip}${level==="usable"?"——AI仍可进行基础推荐":""}${level==="incomplete"?"——AI无法正常推荐":""}`}>{labels[level as keyof typeof labels]}</span>; })()}</div></td>
                      <td className="py-2 pr-3"><div className="flex gap-1.5">
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
                      </div></td>
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
                  <p className="mt-1 text-xs text-stone-500">第一版使用浏览器打印单列标签，条码规则为 barcode = variant SKU。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadInventoryData()} type="button">刷新</button>
                  <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={selectedLabelVariantIds.size === 0 || labelGenerating} onClick={() => void generateSelectedBarcodes()} type="button">
                    {labelGenerating ? "生成中..." : "生成选中 barcode"}
                  </button>
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={selectedLabelItems.length === 0} onClick={openLabelPreview} type="button">打印选中标签</button>
                  <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black text-ink hover:bg-stone-50 disabled:opacity-50" disabled={selectedLabelVariantIds.size === 0} onClick={() => setSelectedLabelVariantIds(new Set())} type="button">清空选择</button>
                </div>
              </div>
              {labelMessage ? <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-700">{labelMessage}</p> : null}
              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px_150px_150px_auto_auto]">
                <input className="input" placeholder="搜索商品名 / SKU / variant SKU / barcode" value={inventoryQ} onChange={e => setInventoryQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadInventoryData(); }} />
                <input className="input" placeholder="尺码，如 S / 38" value={inventorySize} onChange={e => setInventorySize(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadInventoryData(); }} />
                <select className="input" value={inventoryStatus} onChange={e => setInventoryStatus(e.target.value as InventoryStatusFilter)}><option value="all">全部状态</option><option value="normal">正常</option><option value="low_stock">低库存</option><option value="out_of_stock">缺货</option><option value="inactive">停用</option><option value="mismatch">对账异常</option></select>
                <select className="input" value={labelSize} onChange={e => setLabelSize(e.target.value as LabelSize)}><option value="40x30">40 x 30mm</option><option value="50x30">50 x 30mm</option><option value="60x40">60 x 40mm</option></select>
                <label className="flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-sm font-bold text-stone-700">
                  <input checked={labelOnlyMissingBarcode} onChange={e => setLabelOnlyMissingBarcode(e.target.checked)} type="checkbox" />
                  只看无 barcode
                </label>
                <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={inventoryLoading} onClick={() => void loadInventoryData()} type="button">搜索</button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-stone-500">
                <span className="rounded-full bg-stone-100 px-3 py-1.5">当前列表 {filteredLabelItems.length} 个 variant</span>
                <span className="rounded-full bg-stone-100 px-3 py-1.5">已选择 {selectedLabelVariantIds.size} 个</span>
                <button className="rounded-full border border-stone-300 bg-white px-3 py-1.5 font-black text-ink hover:bg-stone-50" onClick={() => setLabelSelection(filteredLabelItems)} type="button">选择当前列表</button>
                <button className="rounded-full border border-stone-300 bg-white px-3 py-1.5 font-black text-ink hover:bg-stone-50" onClick={() => setLabelSelection(filteredLabelItems.filter(item => !item.barcode))} type="button">选择当前无 barcode</button>
              </div>
            </div>

            <div className="admin-panel">
              {filteredLabelItems.length === 0 && !inventoryLoading ? <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-400">暂无可打印标签数据</p> : null}
              <div className="overflow-x-auto rounded-2xl border border-stone-200">
                <table className="min-w-[1120px] w-full text-left text-sm">
                  <thead className="bg-stone-50 text-stone-500">
                    <tr>
                      <th className="px-3 py-2 text-xs font-black"><input checked={filteredLabelItems.length > 0 && filteredLabelItems.every(item => selectedLabelVariantIds.has(item.variant_id))} onChange={e => setLabelSelection(e.target.checked ? filteredLabelItems : [])} type="checkbox" /></th>
                      <th className="px-3 py-2 text-xs font-black">商品</th>
                      <th className="px-3 py-2 text-xs font-black">Product SKU</th>
                      <th className="px-3 py-2 text-xs font-black">Variant SKU</th>
                      <th className="px-3 py-2 text-xs font-black">尺码</th>
                      <th className="px-3 py-2 text-xs font-black">颜色</th>
                      <th className="px-3 py-2 text-xs font-black">Barcode</th>
                      <th className="px-3 py-2 text-right text-xs font-black">价格</th>
                      <th className="px-3 py-2 text-right text-xs font-black">库存</th>
                      <th className="px-3 py-2 text-xs font-black">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLabelItems.map(item => (
                      <tr className="border-t border-stone-100 bg-white align-top" key={item.variant_id}>
                        <td className="px-3 py-3"><input checked={selectedLabelVariantIds.has(item.variant_id)} onChange={() => toggleLabelVariant(item.variant_id)} type="checkbox" /></td>
                        <td className="max-w-[240px] px-3 py-3"><p className="line-clamp-2 font-black text-ink">{item.product_name || "-"}</p></td>
                        <td className="px-3 py-3 font-mono text-xs font-bold text-stone-600">{item.product_sku || "-"}</td>
                        <td className="px-3 py-3 font-mono text-xs font-bold text-stone-600">{item.variant_sku || "-"}</td>
                        <td className="px-3 py-3 text-xs font-bold">{item.size || "-"}</td>
                        <td className="px-3 py-3 text-xs">{item.color || "-"}</td>
                        <td className="px-3 py-3 font-mono text-xs">{item.barcode ? item.barcode : <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">未生成</span>}</td>
                        <td className="px-3 py-3 text-right text-sm font-black text-copper">{formatEuro(item.price)}</td>
                        <td className="px-3 py-3 text-right text-sm font-black text-ink">{item.quantity_on_hand}</td>
                        <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>{item.active ? "启用" : "停用"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
                打印前请先用真实标签纸测试。第一版不做 ESC/POS 或打印机 SDK，只使用浏览器打印。
              </p>
            </div>
          </section>
        ) : null}

        {tab === "add" ? (
          <form className="flex flex-col gap-5" onSubmit={submitProduct}>
            {/* Basic info card */}
            <section className="admin-panel">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="text-base font-black text-ink">基础信息</h2>
                <p className="text-xs font-bold text-stone-400">AI 补全后需要检查并点击保存才会写入数据库。</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="SKU">
                  <div className="flex gap-1.5">
                    <input className="input flex-1" data-admin-field="sku" required value={form.sku} onChange={e => updateField("sku", e.target.value)} />
                    <button className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-[11px] font-bold hover:bg-stone-50 whitespace-nowrap" onClick={generateNextSku} type="button">生成编号</button>
                  </div>
                  <p className="mt-1 text-[10px] text-stone-400">切换分类自动生成前缀: {skuPrefix(form.category, form.subcategory)}001</p>
                </Field>
                <Field label="分类"><select className="input" data-admin-field="category" value={form.category} onChange={e => updateField("category", e.target.value as ProductCategory)}>{(dbCats.length > 0 ? dbCats : categories.map(c => ({slug:c.slug}))).map((c:Record<string,unknown>) => <option key={String(c.slug)} value={String(c.slug)}>{String(c.slug)}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" data-admin-field="subcategory" value={form.subcategory} onChange={e => updateField("subcategory", e.target.value)}>{(() => { if (dbSubs.length > 0) { const cat = dbCats.find(x => String(x.slug) === form.category); const list = cat ? dbSubs.filter(s => String(s.category_id) === String(cat.id)) : []; return list.map((s: Record<string, unknown>) => <option key={String(s.slug)} value={String(s.slug)}>{String(s.slug)}</option>); } if (form.category in subcategoryList) { return subcategoryList[form.category].map(s => <option key={s} value={s}>{s}</option>); } return null; })()}</select></Field>
                <Field label="价格"><input className="input" data-admin-field="price" min="0" step="0.01" type="number" value={form.price} onChange={e => updateField("price", Number(e.target.value))} /></Field>
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
                <Field label="上架"><select className="input" data-admin-field="is_active" value={form.is_active ? "true" : "false"} onChange={e => updateField("is_active", e.target.value === "true")}><option value="true">是</option><option value="false">否</option></select></Field>
              </div>
            </section>

            {/* Size-Stock card */}
            <section className="admin-panel">
              <h2 className="mb-1 text-base font-black text-ink">尺码库存</h2>
              <p className="mb-3 text-xs text-stone-500">库存为 0 的尺码在前台显示为售罄。总库存由尺码库存自动计算。</p>
              {editingId && Object.keys(sizeStock).length === 0 && form.sizes.trim() ? <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">该商品还没有尺码库存。旧总库存为 <b>{form.stock}</b>，sizes 为 "{form.sizes}"。请手动分配库存到各尺码后保存，保存后将自动计算总库存。</p> : null}
              <div className="mb-3 flex flex-wrap gap-2">
                {sizeOptionsForCategory(form.category).map(s => <button key={s} className="min-h-10 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black shadow-sm shadow-stone-900/5 hover:bg-stone-100" onClick={() => addSize(s)} type="button">{s}</button>)}
                <button className="min-h-10 rounded-xl border border-dashed border-stone-300 px-3 py-2 text-xs font-black text-stone-500 hover:border-stone-400" onClick={toggleSizeSummary} type="button">查看 sizes 尺码库存</button>
                {sizeKindForCategory(form.category) !== "one" ? <button className="min-h-10 rounded-xl border border-dashed border-stone-300 px-3 py-2 text-xs font-black text-stone-500 hover:border-stone-400" onClick={addCustomSize} type="button">+ 自定义</button> : null}
              </div>
              {/* Size summary (lightweight, no duplicate table) */}
              {showSizeSummary ? (
                <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-black text-ink">sizes 字段分析</p>
                    <button className="text-xs font-bold text-stone-400 hover:text-ink" onClick={() => setShowSizeSummary(false)} type="button">× 关闭</button>
                  </div>
                  <p className="text-[11px] text-stone-600">基础 sizes：<span className="font-bold">{form.sizes || "—"}</span></p>
                  <p className="text-[11px] text-stone-600">库存表已有：<span className="font-bold">{sortSizeKeys(Object.keys(sizeStock)).join(", ") || "无"}</span></p>
                  {form.sizes ? (() => { const parts = form.sizes.split(/[\/,\s]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean); const missing = parts.filter(s => !(s in sizeStock)); return missing.length > 0 ? <p className="text-[11px] text-amber-700">缺失尺码：<span className="font-bold">{missing.join(", ")}</span></p> : <p className="text-[11px] text-green-700">所有 sizes 尺码都在库存表中 ✓</p>; })() : null}
                  {form.sizes ? (() => { const parts = form.sizes.split(/[\/,\s]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean); const missing = parts.filter(s => !(s in sizeStock)); return missing.length > 0 ? <button className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100" onClick={addMissingSizes} type="button">补充缺失尺码（不覆盖已有库存）</button> : null; })() : null}
                </div>
              ) : null}

              {Object.keys(sizeStock).length > 0 ? (
                <div className="rounded-lg border border-stone-200 overflow-hidden">
                  <table className="w-full text-sm"><thead><tr className="bg-stone-50 text-stone-500"><th className="py-2 px-3 text-left text-xs font-bold">尺码</th><th className="py-2 px-3 text-left text-xs font-bold">库存</th><th className="py-2 px-3 text-center text-xs font-bold w-20">状态</th><th className="py-2 px-3 text-right text-xs font-bold w-12">操作</th></tr></thead>
                    <tbody>
                      {sortSizeKeys(Object.keys(sizeStock)).map(sz => { const qty = sizeStock[sz]; return (
                        <tr className="border-t border-stone-100" key={sz}>
                          <td className="py-1.5 px-3 text-sm font-bold text-ink align-middle">{sz}</td>
                          <td className="py-1.5 px-3 align-middle"><input className="w-20 rounded border border-stone-200 px-2 py-1 text-sm text-center" min="0" step="1" type="number" value={qty} onChange={e => setSizeStock(prev => ({ ...prev, [sz]: Math.max(0, parseInt(e.target.value) || 0) }))} /></td>
                          <td className="py-1.5 px-3 text-center align-middle">{qty > 0 ? <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800 whitespace-nowrap">有货</span> : <span className="inline-block rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-400 whitespace-nowrap">售罄</span>}</td>
                          <td className="py-1.5 px-3 text-right">{sizeKindForCategory(form.category) !== "one" ? <button className="text-[11px] font-bold text-red-500 hover:text-red-700" onClick={() => setSizeStock(prev => { const n = { ...prev }; delete n[sz]; return n; })} type="button">×</button> : null}</td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-stone-400">请选择尺码并填写库存。库存为 0 的尺码前台显示为售罄。</p>}
              {Object.keys(sizeStock).length > 0 ? <p className="mt-2 text-xs text-stone-500">总库存（所有尺码合计）：{Object.values(sizeStock).reduce((a,b)=>a+b,0)}，保存时自动同步到基础信息的库存和 sizes 字段。</p> : null}
            </section>

            {/* i18n card */}
            <section className="admin-panel">
              <h2 className="mb-4 text-base font-black text-ink">多语言内容</h2>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-3"><Field label="中文名"><input className="input" data-admin-field="name_cn" value={form.name_cn} onChange={e => updateField("name_cn", e.target.value)} /></Field><Field label="中文描述"><textarea className="input min-h-24" data-admin-field="description_cn" value={form.description_cn} onChange={e => updateField("description_cn", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="希腊语名"><input className="input" data-admin-field="name_gr" value={form.name_gr} onChange={e => updateField("name_gr", e.target.value)} /></Field><Field label="希腊语描述"><textarea className="input min-h-24" data-admin-field="description_gr" value={form.description_gr} onChange={e => updateField("description_gr", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="英文名"><input className="input" data-admin-field="name_en" value={form.name_en} onChange={e => updateField("name_en", e.target.value)} /></Field><Field label="英文描述"><textarea className="input min-h-24" data-admin-field="description_en" value={form.description_en} onChange={e => updateField("description_en", e.target.value)} /></Field></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={aiCopyLoading} onClick={() => void generateProductCopy()} type="button">{aiCopyLoading ? "生成中..." : "AI 生成商品文案"}</button>
                <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" disabled={translating} onClick={() => void translateProduct()} type="button">{translating ? "翻译中..." : "自动翻译"}</button>
                {editingId ? <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={() => { setEditingId(null); setForm(emptyProduct); }} type="button">取消编辑</button> : null}
              </div>
            </section>

            {/* AI 导购信息 card */}
            <section className="admin-panel">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-black text-ink">AI 导购信息</h2>
                <button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50" disabled={aiMetaLoading || !form.name_cn.trim() && !form.name_en.trim()} onClick={() => void generateAiMeta()} type="button">{aiMetaLoading ? "生成中..." : "自动生成 AI 导购信息"}</button>
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
                  <p className="mt-1 text-[10px] text-stone-400">AI 生成的材质仅供参考，请根据商品吊牌或供货信息确认后再保存。</p>
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-ink cursor-pointer"><input type="checkbox" checked={!!((form as Record<string,unknown>).material_verified)} onChange={e => updateField("material_verified" as keyof ProductFormData, e.target.checked as unknown as string)} /> 材质已人工确认</label>
                </Field>
                <Field label="AI关键词（逗号分隔）">
                  <input className="input" value={form.ai_keywords} onChange={e => updateField("ai_keywords", e.target.value)} placeholder="summer, casual, cotton" />
                </Field>
                <Field label="风格标签（逗号分隔）">
                  <input className="input" value={form.style_tags} onChange={e => updateField("style_tags", e.target.value)} placeholder="minimal, greek, mediterranean" />
                </Field>
              </div>
              <div className="mt-3">
                {!showSizeChart ? (
                  <button className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-[11px] font-bold text-stone-400 hover:border-stone-400" onClick={() => setShowSizeChart(true)} type="button">展开高级尺码表（选填）</button>
                ) : (
                  <Field label="AI 尺码表（选填，高级）">
                    <div className="flex items-center justify-between mb-2">
                      <button className="text-[11px] font-bold text-stone-400 hover:text-ink" onClick={() => setShowSizeChart(false)} type="button">收起</button>
                      <button className="rounded border border-stone-200 px-2 py-1 text-[10px] font-bold text-stone-500 hover:bg-stone-50" onClick={() => { const examples: Record<string,string> = { tshirts: `{"S":{"bust":"88-92","shoulder":"38-40","length":"66-68","height":"160-170","weight":"45-55"},"M":{"bust":"92-96","shoulder":"40-42","length":"68-70","height":"165-175","weight":"55-65"},"L":{"bust":"96-100","shoulder":"42-44","length":"70-72","height":"170-180","weight":"65-75"},"XL":{"bust":"100-104","shoulder":"44-46","length":"72-74","height":"175-185","weight":"75-85"}}`, shirts: `{"S":{"bust":"92-96","shoulder":"39-41","length":"70-72","height":"160-170"},"M":{"bust":"96-100","shoulder":"41-43","length":"72-74","height":"165-175"},"L":{"bust":"100-104","shoulder":"43-45","length":"74-76","height":"170-180"},"XL":{"bust":"104-108","shoulder":"45-47","length":"76-78","height":"175-185"}}`, dresses: `{"S":{"bust":"84-88","waist":"64-68","hips":"88-92","height":"160-165"},"M":{"bust":"88-92","waist":"68-72","hips":"92-96","height":"165-170"},"L":{"bust":"92-96","waist":"72-76","hips":"96-100","height":"170-175"},"XL":{"bust":"96-100","waist":"76-80","hips":"100-104","height":"175-180"}}`, trousers: `{"S":{"waist":"70-74","hips":"88-92","length":"100-104","weight":"45-55"},"M":{"waist":"74-78","hips":"92-96","length":"102-106","weight":"55-65"},"L":{"waist":"78-82","hips":"96-100","length":"104-108","weight":"65-75"},"XL":{"waist":"82-86","hips":"100-104","length":"106-110","weight":"75-85"}}` }; const cat = ["hoodies","jackets","shirts","tshirts"].includes(form.subcategory) ? "shirts" : ["dresses","skirts","tops"].includes(form.subcategory) ? "dresses" : ["trousers","jeans","shorts"].includes(form.subcategory) ? "trousers" : "tshirts"; updateField("size_chart", examples[cat] || examples.tshirts); }} type="button">插入示例尺码表</button>
                    </div>
                    <textarea className="input min-h-28 font-mono text-[11px]" value={form.size_chart} onChange={e => updateField("size_chart", e.target.value)} placeholder={`{"S":{"bust":"80-84","waist":"62-66","length":"58-60"},"M":{"bust":"84-88","waist":"66-70","length":"60-62"}}`} />
                    <p className="mt-1 text-[10px] text-stone-400">可不填。填写后 AI 尺码推荐更准确；不填写时 AI 会根据商品尺码、版型、顾客身高体重给参考建议。</p>
                  </Field>
                )}
              </div>
            </section>

            {/* Image & links card */}
            <section className="admin-panel">
              <h2 className="mb-4 text-base font-black text-ink">图片与链接</h2>

              {/* Inline upload — only when editing */}
              {editingId ? (
                <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="text-sm font-black text-ink">上传图片到当前商品</h3>
                  <p className="mt-1 text-xs text-stone-500">直接上传主图或多图，自动写入商品字段。</p>
                  <p className="mt-1 text-[10px] text-amber-700">Skroutz 要求图片至少一边 ≥ 1000px，建议 1200×1200 以上。</p>
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
                  <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                    <p className="text-xs font-black text-ink">AI 模特穿搭图（选填）</p>
                    <p className="mt-1 text-[11px] text-stone-500">先上传真实正面/背面图，再生成参考穿搭图。生成图会加入多图，不会替换主图。</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input className="input bg-white" value={styleImageStyle} onChange={e => setStyleImageStyle(e.target.value)} placeholder="Mediterranean boutique look" />
                      <input className="input bg-white" value={styleImageModelType} onChange={e => setStyleImageModelType(e.target.value)} placeholder="adult fashion model" />
                      <button className="rounded-lg border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50" disabled={loading || styleImageSku === form.sku || !form.image_url} onClick={() => void generateStyleImageForCurrentProduct()} type="button">{styleImageSku === form.sku ? "生成中..." : "生成 AI 模特图"}</button>
                    </div>
                  </div>
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

              {/* URL fields */}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="主图 URL"><input className="input" data-admin-field="image_url" value={form.image_url} onChange={e => updateField("image_url", e.target.value)} /></Field>
                <Field label="Skroutz URL"><input className="input" placeholder="https://www.skroutz.gr/..." value={form.skroutz_url} onChange={e => updateField("skroutz_url", e.target.value)} /></Field>
                <Field label="品牌（可选）"><input className="input" value={form.brand} onChange={e => updateField("brand", e.target.value)} placeholder="如无可留空" /></Field>
                <Field label="条码 / EAN（可选）"><input className="input" value={form.barcode} onChange={e => updateField("barcode", e.target.value)} placeholder="如无可留空" /></Field>
                <Field label="VAT"><input className="input" min="0" step="0.01" type="number" value={form.vat} onChange={e => updateField("vat", Number(e.target.value))} /></Field>
                <Field label="颜色（选填）"><input className="input" value={form.color} onChange={e => updateField("color", e.target.value)} placeholder="black / red / blue，可留空" /></Field>
              </div>
              <div className="mt-3"><Field label="多图 URL（一行一个，可用逗号分隔）"><textarea className="input min-h-24" value={form.image_urls} onChange={e => updateField("image_urls", e.target.value)} /></Field></div>
            </section>

            {/* Save buttons — sticky at bottom */}
            <div className="admin-sticky-actions">
              <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
                <button className="admin-button-primary w-full sm:w-auto" disabled={loading} type="submit">{editingId ? "保存修改" : "新增商品"}</button>
                {editingId ? <button className="admin-button-secondary w-full sm:w-auto" onClick={() => { setEditingId(null); setForm(emptyProduct); setSizeStock({}); setTab("dashboard"); }} type="button">取消编辑</button> : null}
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
            <p className="mb-4 text-xs text-stone-500">SKU 已存在则更新，不存在则新增。中文商品自动翻译英文和希腊语。</p>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black hover:bg-stone-50" onClick={downloadQuickCsvTemplate} type="button">下载快速 CSV 模板</button>
              <button className="min-h-11 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-black hover:bg-stone-50" onClick={downloadCsvTemplate} type="button">下载完整 CSV 模板</button>
              <button className="min-h-11 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={csvRows.length === 0 || loading} onClick={confirmImportCsv} type="button">导入 CSV</button>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
              <label className="block text-sm font-black text-ink">选择 CSV 文件</label>
              <input accept=".csv,text/csv" className="input mt-2 min-h-12 bg-white" onChange={e => void handleCsv(e.target.files?.[0] || null)} type="file" />
            </div>
            <p className="mt-2 text-xs text-stone-500">快速模板只保留日常上新字段，图片 URL 可以留空，之后用批量上传按 SKU 自动绑定；完整模板适合从备份迁移或填写 AI / 尺码表等高级字段。</p>
            <p className="mt-2 text-xs text-stone-400">字段：{csvFields.join(", ")}</p>
            {csvRows.length > 0 ? (
              <div className="mt-4">
                <p className="rounded-2xl border border-stone-200 bg-white p-3 text-sm font-black text-ink shadow-sm shadow-stone-900/5">预览：有效 {csvSummary.valid}，错误 {csvSummary.invalid}{csvSummary.needsTranslation > 0 ? `，需翻译 ${csvSummary.needsTranslation}` : ""}</p>
                <ResultTable results={csvRows.map(r => { const errs = validatePreviewRow(r); let msg = errs.length === 0 ? "OK" : errs.join("; "); if (errs.length === 0) { const nc = String(r.name_cn||"").trim(), dc = String(r.description_cn||"").trim(); if (nc||dc) { const ne = String(r.name_en||"").trim(), de = String(r.description_en||"").trim(), ng = String(r.name_gr||"").trim(), dg = String(r.description_gr||"").trim(); msg = ne&&de&&ng&&dg ? "OK，无需翻译" : "OK，需翻译"; } } return { rowNumber: Number(r.rowNumber), sku: String(r.sku||""), ok: errs.length === 0, message: msg }; })} />
              </div>
            ) : null}
            {csvResults.length > 0 ? <ResultTable results={csvResults} /> : null}
          </section>
        ) : null}

        {/* ── TAB: Bulk Images ──────────────────────────────── */}
        {tab === "images" ? (
          <section className="flex flex-col gap-5">
            <div className="admin-panel">
              <h2 className="mb-1 text-lg font-black text-ink">选择商品上传</h2>
              <p className="mb-3 text-xs text-stone-500">用分类和搜索筛选商品，再上传主图或多图。Skroutz 建议图片最长边 1000-1600px。</p>
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <input className="input" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部分类</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select>
                <select className="input" value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat && isProductCategory(filterCat) ? subcategoryList[filterCat].map(s => <option key={s} value={s}>{s}</option>) : null}</select>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block rounded-2xl border border-stone-200 bg-stone-50/70 p-3"><span className="text-sm font-bold text-ink">商品</span><select className="input mt-2" value={selectedImageSku} onChange={e => setSelectedImageSku(e.target.value)}><option value="">选择商品 SKU</option>{filteredProducts.map(p => <option key={p.id} value={p.sku}>{p.sku} - {p.name_cn || p.name_gr || p.name_en || "未命名"} - {p.category}/{p.subcategory}</option>)}</select></label>
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
        {tab === "categories" ? <CategoriesManager activePassword={activePassword} toast={toast} confirm={setConfirm} dismissConfirm={dismissConfirm} /> : null}

        {/* ── TAB: Skroutz Feed ───────────────────────────── */}
        {tab === "skroutz" ? (
          <section className="flex flex-col gap-5">
            {/* Header */}
            <div className="admin-panel">
              <h2 className="text-lg font-black text-ink">Skroutz Feed 状态</h2>
              <p className="mt-1 text-xs text-stone-400">将此 Feed 链接提交给 Skroutz，用于同步商品名称、价格、库存、图片和商品链接。</p>
              <div className="mt-4 flex items-center gap-2">
                {feedStats.noImage === 0 && feedStats.noDesc === 0 && feedStats.noStock === 0 ? (
                  <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">Feed 状态良好，可以提交给 Skroutz</span>
                ) : (
                  <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                    Feed 有 {(() => { const issues: string[] = []; if (feedStats.noImage > 0) issues.push(`${feedStats.noImage} 个缺公网主图`); if (feedStats.noDesc > 0) issues.push(`${feedStats.noDesc} 个缺描述`); if (feedStats.noStock > 0) issues.push(`${feedStats.noStock} 个无库存`); return issues.length; })()} 个问题：{(() => { const issues: string[] = []; if (feedStats.noImage > 0) issues.push(`${feedStats.noImage} 个缺公网主图`); if (feedStats.noDesc > 0) issues.push(`${feedStats.noDesc} 个缺描述`); if (feedStats.noStock > 0) issues.push(`${feedStats.noStock} 个无库存`); return issues.join("，"); })()}
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
              {[{ label: "Feed 商品数", v: feedStats.total, color: "" }, { label: "缺公网主图", v: feedStats.noImage, color: feedStats.noImage > 0 ? "" : "" }, { label: "缺描述", v: feedStats.noDesc, color: "" }, { label: "无库存", v: feedStats.noStock, color: "" }, { label: "测试商品隐藏", v: feedStats.testHidden, color: "" }].map(s => (
                <div key={s.label} className="rounded-2xl border border-stone-100 bg-white p-3 text-center shadow-sm shadow-stone-900/5 sm:p-5">
                  <p className={`text-2xl font-black ${(s.label === "缺公网主图"||s.label==="缺描述") && s.v > 0 ? "text-amber-600" : s.label === "无库存" && s.v > 0 ? "text-red-500" : "text-ink"}`}>{s.v}</p>
                  <p className="mt-1 text-xs font-bold text-stone-400">{s.label}</p>
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
          onClose={() => setPosReceiptDetail(null)}
        />
      ) : null}

      {labelPreviewItems ? (
        <LabelPrintPreview
          labels={labelPreviewItems}
          labelSize={labelSize}
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

function CategoriesManager({ activePassword, toast, confirm, dismissConfirm }: { activePassword: string; toast: (m: string, t?: "ok" | "err") => void; confirm: (c: { open: boolean; title: string; desc: string; confirmText: string; variant: "danger"|"success"|"default"; action: () => void }) => void; dismissConfirm: () => void }) {
  const [cats, setCats] = useState<Array<Record<string, unknown>>>([]);
  const [subs, setSubs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  async function load() { setLoading(true); try { const r = await fetch("/api/admin/categories", { headers: { "x-admin-password": activePassword } }); const d = await r.json(); setCats(d.categories || []); setSubs(d.subcategories || []); } catch {} finally { setLoading(false); } }
  useEffect(() => { load(); }, [activePassword]);

  function updateCat(idx: number, key: string, val: unknown) { setCats(prev => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; }); }
  function updateSub(idx: number, key: string, val: unknown) { setSubs(prev => { const n = [...prev]; n[idx] = { ...n[idx], [key]: val }; return n; }); }
  function addCat() { const newCat = { id: "", slug: "", name_cn: "", name_en: "", name_gr: "", image_url: "", sort_order: cats.length + 1, is_active: true }; setCats(prev => [...prev, newCat as Record<string, unknown>]); }
  function addSub(catId: string) { const newSub = { id: "", category_id: catId, slug: "", name_cn: "", name_en: "", name_gr: "", sort_order: subs.filter(s => s.category_id === catId).length + 1, is_active: true }; setSubs(prev => [...prev, newSub as Record<string, unknown>]); }
  function removeSub(idx: number) { const s = subs[idx]; const id = String(s.id||""); const slug = String(s.slug||""); confirm({ open: true, title: "删除二级分类", desc: `确认删除二级分类 ${slug}？`, confirmText: "确认删除", variant: "danger", action: () => { setSubs(prev => prev.filter(x => String(x.id||"") !== id || String(x.slug||"") !== slug)); dismissConfirm(); } }); }
  function removeCat(idx: number) { const c = cats[idx]; const slug = String(c.slug||""); const id = String(c.id||""); if (!slug) return; confirm({ open: true, title: "删除分类", desc: `确认删除分类 ${slug}？`, confirmText: "确认删除", variant: "danger", action: () => { setCats(prev => prev.filter(x => String(x.id||"") !== id || String(x.slug||"") !== slug)); dismissConfirm(); } }); }

  async function save() { setLoading(true); try { await fetch("/api/admin/categories", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ categories: cats, subcategories: subs }) }); toast("分类已保存"); load(); } catch { toast("保存失败", "err"); } finally { setLoading(false); } }

  async function uploadCategoryImage(idx: number, file: File | null) {
    if (!file) return;
    const slug = String(cats[idx]?.slug || `category-${idx + 1}`).replace(/[^a-z0-9-]/g, "").toLowerCase() || `category-${idx + 1}`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", `category-${slug}`);
    setLoading(true);
    try {
      const r = await fetch("/api/admin/settings/upload", {
        method: "POST",
        headers: { "x-admin-password": activePassword },
        body: formData,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Category image upload failed");
      updateCat(idx, "image_url", d.url);
      toast("Category image uploaded. Save categories to publish it.");
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
                <p className="min-w-0 truncate text-sm font-black text-ink">{String(c.name_cn || c.name_en || c.slug || "新分类")}</p>
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
                    <input accept="image/*" className="hidden" disabled={loading} type="file" onChange={e => { void uploadCategoryImage(i, e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
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
                      <input accept="image/*" className="hidden" disabled={loading} type="file" onChange={e => { void uploadCategoryImage(i, e.target.files?.[0] || null); e.currentTarget.value = ""; }} />
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
              <h3 className="text-sm font-bold text-ink">{String(c.name_cn||c.name_en||c.slug)} <span className="text-xs text-stone-400 font-normal">({String(c.slug)}) — {catSubs.length} 个二级分类</span></h3>
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
                      <p className="min-w-0 truncate text-sm font-black text-ink">{String(s.name_cn || s.name_en || s.slug || "新二级分类")}</p>
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

function ResultTable({ results }: { results: ApiResult[] }) {
  return (
    <div className="mt-4">
      <div className="grid gap-2 lg:hidden">
        {results.map((r, i) => (
          <article className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/5" key={`${r.sku}-card-${r.fileName || r.rowNumber || i}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-stone-500">{r.fileName || `第 ${r.rowNumber} 行`}</p>
                <p className="mt-1 truncate font-mono text-sm font-black text-ink">{r.sku || "无 SKU"}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${r.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.ok ? "成功" : "失败"}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">{r.message || "-"}</p>
            {r.translateError ? <p className="mt-1 text-xs font-bold text-orange-600">翻译错误: {r.translateError}</p> : null}
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-stone-200 text-stone-500"><th className="py-2 pr-3 text-xs font-bold">#</th><th className="py-2 pr-3 text-xs font-bold">SKU</th><th className="py-2 pr-3 text-xs font-bold">状态</th><th className="py-2 pr-3 text-xs font-bold">说明</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr className="border-b border-stone-50" key={`${r.sku}-${r.fileName || r.rowNumber || i}`}>
                <td className="py-2 pr-3 text-xs">{r.fileName || `第 ${r.rowNumber} 行`}</td><td className="py-2 pr-3 text-xs font-mono">{r.sku}</td>
                <td className={`py-2 pr-3 text-xs font-bold ${r.ok ? "text-green-700" : "text-red-600"}`}>{r.ok ? "成功" : "失败"}</td>
                <td className="py-2 pr-3 text-xs">{r.message}{r.translateError ? <span className="ml-2 text-orange-600">翻译错误: {r.translateError}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
