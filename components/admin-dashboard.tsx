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
import { effectiveStock } from "@/lib/products";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/admin-toast";

/* ── Types ───────────────────────────────────────────────── */
type AdminProduct = ProductFormData & { id: string; size_stock?: Record<string, number> | null };
type ApiResult = { rowNumber?: number; fileName?: string; sku: string; ok: boolean; message: string; imageUrl?: string; translated?: boolean; translateError?: string };
type CsvRow = Record<string, string | number>;
type TranslationResult = { name_gr: string; description_gr: string; name_en: string; description_en: string };
type ImageUploadOptions = { sku?: string; mode?: "main" | "gallery" };
type ImageDeleteOptions = { sku: string; kind: "main" | "gallery"; index?: number };
type Tab = "dashboard" | "add" | "csv" | "images" | "skroutz" | "categories";

/* ── Constants ───────────────────────────────────────────── */
const emptyProduct: ProductFormData = { sku: "", name_cn: "", name_gr: "", name_en: "", description_cn: "", description_gr: "", description_en: "", category: "men", subcategory: "tshirts", price: 0, stock: 0, sizes: "", image_url: "", image_urls: "", brand: "", barcode: "", vat: 24, color: "", skroutz_url: "", is_active: true, fit_type: "regular", material: "", ai_keywords: "", style_tags: "", size_chart: "", material_verified: false };
const csvFields = ["sku","name_cn","description_cn","name_en","description_en","name_gr","description_gr","category","subcategory","price","stock","sizes","size_stock","image_url","image_urls","brand","barcode","vat","color","skroutz_url","is_active"];
const tabs: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "商品列表" }, { key: "add", label: "新增/编辑" }, { key: "csv", label: "CSV 导入" }, { key: "images", label: "批量图片上传" }, { key: "categories", label: "分类管理" }, { key: "skroutz", label: "Skroutz Feed" },
];

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
  const headers = rows.shift()?.map((h) => h.trim()) || [];
  return rows.map((values, i) => { const out: CsvRow = { rowNumber: i + 2 }; headers.forEach((h, hi) => { out[h] = values[hi] || ""; }); return out; });
}
function csvCell(v: string) { return `"${v.replace(/"/g, '""')}"`; }
function downloadCsvTemplate() {
  const sample = ["DEMO-WOMEN-DRESSES-001","女士连衣裙","示例中文描述","Women dress","Sample English description","Γυναικείο φόρεμα","Παράδειγμα περιγραφής","women","dresses","29.90","10","S,M,L","S:2,M:3,L:1,XL:0","","","Fashion Boutique","","24","black","","true"];
  const csv = `${csvFields.join(",")}\n${sample.map(csvCell).join(",")}\n`;
  const b = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "products-template.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
}
function validatePreviewRow(row: CsvRow) {
  const errors: string[] = [];
  const sku = String(row.sku || "").trim(); const cat = String(row.category || "").trim(); const sub = String(row.subcategory || "").trim();
  const price = Number(String(row.price || "").replace(",", ".")); const stock = Number(String(row.stock || "").replace(",", "."));
  const vat = row.vat === undefined || row.vat === "" ? 24 : Number(String(row.vat).replace(",", "."));
  if (!sku) errors.push("sku 必填"); if (!isProductCategory(cat)) errors.push("分类无效");
  if (isProductCategory(cat) && sub && !isProductSubcategory(cat, sub)) errors.push("二级分类无效");
  if (!Number.isFinite(price)) errors.push("价格必须是数字"); if (!Number.isFinite(stock)) errors.push("库存必须是数字");
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
/* ── Main component ──────────────────────────────────────── */
export function AdminDashboard() {
  const { toast } = useToast();
  const [password, setPassword] = useState(""); const [activePassword, setActivePassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct); const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [translating, setTranslating] = useState(false);
  const [aiMetaLoading, setAiMetaLoading] = useState(false);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const editingIdRef = useRef<string | null>(null); editingIdRef.current = editingId;
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]); const [csvResults, setCsvResults] = useState<ApiResult[]>([]);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]); const [selectedImageSku, setSelectedImageSku] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; desc: string; confirmText: string; variant: "danger"|"success"|"default"; action: () => void; prompt?: boolean; promptValue?: string }>({ open: false, title: "", desc: "", confirmText: "确认", variant: "default", action: () => {} });
  const [newMainFile, setNewMainFile] = useState<File | null>(null); const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [sizeStock, setSizeStock] = useState<Record<string, number>>({});
  const [showSizeSummary, setShowSizeSummary] = useState(false);
  const [dbCats, setDbCats] = useState<Array<Record<string,unknown>>>([]);
  const [dbSubs, setDbSubs] = useState<Array<Record<string,unknown>>>([]);
  useEffect(() => { if (activePassword) { fetch("/api/admin/categories", { headers: { "x-admin-password": activePassword } }).then(r => r.json()).then(d => { setDbCats((d.categories||[]).filter((c:Record<string,unknown>) => c.is_active !== false)); setDbSubs((d.subcategories||[]).filter((s:Record<string,unknown>) => s.is_active !== false)); }).catch(() => {}); } }, [activePassword, tab]);

  // Search / filter state
  const [search, setSearch] = useState(""); const [filterCat, setFilterCat] = useState(""); const [filterSub, setFilterSub] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | active | inactive | noimg | nostock | nosizestock | demo

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
    if (filterStatus === "nostock") list = list.filter(p => effectiveStock(p) === 0);
    if (filterStatus === "nosizestock") list = list.filter(p => p.sizes.trim() && !((p as Record<string,unknown>).size_stock && typeof (p as Record<string,unknown>).size_stock === "object" && Object.keys((p as Record<string,unknown>).size_stock as object).length > 0));
    if (filterStatus === "nodesc") list = list.filter(p => !p.description_en?.trim() && !p.description_gr?.trim());
    if (filterStatus === "demo") list = list.filter(p => /TEST|DEMO/i.test(p.sku));
    return list;
  }, [products, search, filterCat, filterSub, filterStatus]);

  // Feed stats
  const feedStats = useMemo(() => ({
    total: products.filter(p => p.is_active && effectiveStock(p) >= 0).length,
    noImage: products.filter(p => p.is_active && effectiveStock(p) >= 0 && !p.image_url).length,
    noDesc: products.filter(p => p.is_active && effectiveStock(p) >= 0 && !p.description_en && !p.description_gr).length,
  }), [products]);

  /* ── API helper ───────────────────────────────────────── */
  async function api(path: string, init: RequestInit = {}) {
    const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "x-admin-password": activePassword, ...(init.headers || {}) } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  }
  async function readJson(r: Response, fallback: string) { const ct = r.headers.get("Content-Type")||""; if (ct.includes("json")) return r.json(); const t = await r.text(); throw new Error(t ? `${fallback}: ${t.slice(0, 160)}` : fallback); }

  async function loadProducts() { setLoading(true); try { const d = await api("/api/admin/products?limit=500"); setProducts(d.products||[]); } catch (e) { toast(e instanceof Error ? e.message : "商品读取失败", "err"); } finally { setLoading(false); } }
  useEffect(() => { if (activePassword) void loadProducts(); }, [activePassword]);

  function skuPrefix(cat: string, sub: string) { return `${cat || "x"}-${sub || "x"}-`; }
  function updateField<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) { setForm(c => { if (key === "category") { const nextCat = value as ProductCategory; const nextSub = subcategoryList[nextCat]?.[0] || ""; const prefix = skuPrefix(nextCat, nextSub); const oldPrefix = skuPrefix(c.category, c.subcategory); const skuEmpty = !c.sku.trim() || c.sku === oldPrefix || c.sku.trim() === oldPrefix.replace(/-$/, ""); return { ...c, category: nextCat, subcategory: nextSub, sku: skuEmpty ? prefix : c.sku }; } if (key === "subcategory") { const prefix = skuPrefix(c.category, value as string); const oldPrefix = skuPrefix(c.category, c.subcategory); const skuEmpty = !c.sku.trim() || c.sku === oldPrefix || c.sku.trim() === oldPrefix.replace(/-$/, ""); return { ...c, subcategory: value as string, sku: skuEmpty ? prefix : c.sku }; } return { ...c, [key]: value }; }); }
  function generateNextSku() { const prefix = skuPrefix(form.category, form.subcategory); const existing = products.filter(p => p.sku.startsWith(prefix)); let max = 0; for (const p of existing) { const rest = p.sku.slice(prefix.length); const n = parseInt(rest, 10); if (!isNaN(n) && n > max) max = n; } const next = String(max + 1).padStart(3, "0"); updateField("sku", prefix + next); toast(`SKU 已生成: ${prefix + next}`); }
  function loadSizeStock(p: AdminProduct) { const ss = (p as Record<string,unknown>).size_stock; if (ss && typeof ss === 'object' && !Array.isArray(ss)) { const rec: Record<string,number> = {}; for (const [k,v] of Object.entries(ss as Record<string,unknown>)) { if (typeof v === 'number') rec[k.toUpperCase()] = v; } setSizeStock(rec); } else { setSizeStock({}); } }
  function startEdit(p: AdminProduct) { setEditingId(p.id); setForm({ sku:p.sku, name_cn:p.name_cn, name_gr:p.name_gr, name_en:p.name_en, description_cn:p.description_cn, description_gr:p.description_gr, description_en:p.description_en, category:p.category, subcategory:p.subcategory, price:p.price, stock:p.stock, sizes:p.sizes, image_url:p.image_url, image_urls:p.image_urls, brand:p.brand, barcode:p.barcode, vat:p.vat, color:p.color, skroutz_url:p.skroutz_url, is_active:p.is_active, material: p.material || (p as Record<string,unknown>).material as string || "", fit_type: (p as Record<string,unknown>).fit_type as string || "regular", ai_keywords: Array.isArray((p as Record<string,unknown>).ai_keywords) ? ((p as Record<string,unknown>).ai_keywords as string[]).join(",") : String((p as Record<string,unknown>).ai_keywords || ""), style_tags: Array.isArray((p as Record<string,unknown>).style_tags) ? ((p as Record<string,unknown>).style_tags as string[]).join(",") : String((p as Record<string,unknown>).style_tags || ""), size_chart: typeof (p as Record<string,unknown>).size_chart === "object" ? JSON.stringify((p as Record<string,unknown>).size_chart) : String((p as Record<string,unknown>).size_chart || ""), material_verified: (p as Record<string,unknown>).material_verified === true }); loadSizeStock(p); setShowSizeChart(!!((typeof (p as Record<string,unknown>).size_chart === "object" ? JSON.stringify((p as Record<string,unknown>).size_chart) : String((p as Record<string,unknown>).size_chart || "")).trim())); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function copyProduct(p: AdminProduct) { setEditingId(null); setForm({ ...p, sku: p.sku + "-COPY" }); loadSizeStock(p); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function addSize(sz: string) { setSizeStock(prev => { if (sz in prev) return prev; return { ...prev, [sz]: 0 }; }); }
  function toggleSizeSummary() { setShowSizeSummary(prev => !prev); }
  function addMissingSizes() { const parts = form.sizes.split(/[\/,\s]+/).map((s: string) => s.trim().toUpperCase()).filter(Boolean); if (parts.length === 0) { toast("sizes 字段为空", "err"); return; } setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const s of parts) { if (!(s in next)) { next[s] = 0; added++; } } if (added > 0) { toast(`已补充 ${added} 个缺失尺码，已有库存不变`); return next; } toast("所有 sizes 尺码已在库存表中"); return prev; }); }
  const SIZE_ORDER = ["XS","S","M","L","XL","XXL","XXXL"];
  function sortSizeKeys(keys: string[]) { return keys.sort((a,b) => { const ai = SIZE_ORDER.indexOf(a); const bi = SIZE_ORDER.indexOf(b); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.localeCompare(b); }); }
  function addCustomSize() { const raw = prompt("输入尺码名称，多个用逗号分隔", ""); if (!raw) return; const names = raw.split(/[\/,\s]+/).map((x: string) => x.trim().toUpperCase()).filter(Boolean); if (names.length === 0) return; setSizeStock(prev => { let added = 0; const next = { ...prev }; for (const k of names) { if (!(k in next)) { next[k] = 0; added++; } } if (added > 0) { toast(`已添加 ${added} 个尺码`); return next; } toast("所有尺码已存在"); return prev; }); }

  /* ── Translate ────────────────────────────────────────── */
  async function translateProduct() {
    if (!form.name_cn.trim() && !form.description_cn.trim()) { toast("请先填写中文名称或中文描述。", "err"); return; }
    if (form.name_gr || form.description_gr || form.name_en || form.description_en) { setConfirm({ open: true, title: "自动翻译", desc: "当前已有希腊语或英语内容，是否用自动翻译结果覆盖？", confirmText: "覆盖翻译", variant: "danger", action: () => { setConfirm(c => ({ ...c, open: false })); doTranslate(); } }); return; }
    doTranslate();
  }
  async function doTranslate() { setTranslating(true); try { const d = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: form.name_cn, description_cn: form.description_cn }) }) as TranslationResult; setForm(c => ({ ...c, name_gr: d.name_gr, description_gr: d.description_gr, name_en: d.name_en, description_en: d.description_en })); toast("翻译已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "自动翻译失败", "err"); } finally { setTranslating(false); } }
  async function generateAiMeta() { setAiMetaLoading(true); try { const r = await fetch("/api/admin/generate-ai-meta", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify({ product: { name_cn: form.name_cn, name_en: form.name_en, name_gr: form.name_gr, description_en: form.description_en, category: form.category, subcategory: form.subcategory, price: form.price, sizes: form.sizes } }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "生成失败"); setForm(c => ({ ...c, fit_type: d.fit_type || c.fit_type, material: d.material || c.material, ai_keywords: d.ai_keywords || c.ai_keywords, style_tags: d.style_tags || c.style_tags, material_verified: false })); toast("AI 导购信息已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "AI 生成失败", "err"); } finally { setAiMetaLoading(false); } }

  /* ── Submit / Delete ──────────────────────────────────── */
  async function submitProduct(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (!form.sku.trim()) { toast("请填写 SKU", "err"); return; } if (!form.name_cn.trim() && !form.name_en.trim() && !form.name_gr.trim()) { toast("请至少填写一个语言的商品名", "err"); return; } if (form.size_chart.trim()) { try { JSON.parse(form.size_chart.trim()); } catch { toast("尺码表 JSON 格式不正确，请检查", "err"); return; } }
if (!form.image_url && !newMainFile) { setConfirm({ open: true, title: "商品没有图片", desc: "该商品没有主图，是否继续保存？", confirmText: "继续保存", variant: "default", action: () => { setConfirm(c => ({ ...c, open: false })); doSubmit(); } }); return; } doSubmit(); }
  async function doSubmit() { setLoading(true); const p = normalizeProduct(form); const aiData: Record<string, unknown> = {}; if (p.ai_keywords.trim()) aiData.ai_keywords = p.ai_keywords.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean); if (p.style_tags.trim()) aiData.style_tags = p.style_tags.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean); if (p.size_chart.trim()) aiData.size_chart = JSON.parse(p.size_chart.trim()); if (p.fit_type) aiData.fit_type = p.fit_type; aiData.material_verified = p.material_verified === true; const sizeKeys = Object.keys(sizeStock); const hasSizeStock = sizeKeys.length > 0; const totalStock = sizeKeys.reduce((sum, k) => sum + (sizeStock[k] || 0), 0); const payload = { ...(p as Record<string,unknown>), ...aiData, ...(hasSizeStock ? { sizes: sortSizeKeys(sizeKeys).join(","), size_stock: sizeStock, stock: totalStock } : {}) }; const url = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products"; const method = editingId ? "PUT" : "POST"; try { const saved = await api(url, { method, body: JSON.stringify(payload) }); toast(editingId ? "商品已更新" : "商品已新增"); if (!editingId && (newMainFile || newGalleryFiles.length > 0)) { const sku = saved?.product?.sku || form.sku; let imgOk = 0; let imgFail = 0; const imgErrors: string[] = []; try { if (newMainFile) { const fd = new FormData(); fd.append("images", newMainFile); fd.append("sku", sku); fd.append("mode", "main"); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: fd }); const d = await r.json(); const results = (d.results||[]) as ApiResult[]; for (const res of results) { if (res.ok) imgOk++; else { imgFail++; if (res.message) imgErrors.push(res.message); } } } if (newGalleryFiles.length > 0) { const fd = new FormData(); newGalleryFiles.forEach(f => fd.append("images", f)); fd.append("sku", sku); fd.append("mode", "gallery"); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body: fd }); const d = await r.json(); const results = (d.results||[]) as ApiResult[]; for (const res of results) { if (res.ok) imgOk++; else { imgFail++; if (res.message) imgErrors.push(res.message); } } } if (imgFail > 0) { toast(`商品已保存。图片：成功 ${imgOk}，失败 ${imgFail}${imgErrors.length > 0 ? `（${imgErrors.join("；")}）` : ""}`, "err"); } else { toast("商品已保存，图片已上传"); } } catch { toast("商品已保存，图片上传失败", "err"); } setNewMainFile(null); setNewGalleryFiles([]); } setForm(emptyProduct); setEditingId(null); setSizeStock({}); setTab("dashboard"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "保存失败", "err"); } finally { setLoading(false); } }
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

  /* ── Login gate ─────────────────────────────────────────── */
  if (!activePassword) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <section className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm text-center">
          <div className="mb-6">
            <svg className="mx-auto h-10 w-10 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
          <h1 className="text-xl font-black text-ink">商品管理后台</h1>
          <p className="mt-2 text-sm text-stone-500">Fashion Store Admin</p>
          <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); setActivePassword(password); }}>
            <input className="input text-center" onChange={e => setPassword(e.target.value)} type="password" value={password} placeholder="管理密码" />
            <button className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-stone-800">登录</button>
          </form>
        </section>
      </main>
    );
  }

  /* ── Logged-in UI ────────────────────────────────────────── */
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        {/* ── Top bar ────────────────────────────────────── */}
        <header className="mb-6 flex flex-col gap-3 border-b border-stone-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
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
            <div key={s.label} className="relative overflow-hidden rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
              <div className={`absolute top-0 left-0 w-1 h-full ${s.color} rounded-l-full`} />
              <p className="text-2xl font-black text-ink">{s.v}</p>
              <p className="mt-0.5 text-[11px] font-bold text-stone-400">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab bar ─────────────────────────────────────── */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-stone-100 bg-white p-1 shadow-sm">
          {tabs.map(t => (
            <button key={t.key} className={`shrink-0 rounded-lg px-5 py-2.5 text-sm font-bold transition ${tab === t.key ? "bg-ink text-white shadow-sm" : "text-stone-400 hover:text-ink hover:bg-stone-100"}`} onClick={() => setTab(t.key)} type="button">{t.label}</button>
          ))}
        </nav>

        {/* ── TAB: Dashboard ──────────────────────────────── */}
        {tab === "dashboard" ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
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
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部状态</option><option value="active">已上架</option><option value="inactive">已下架</option><option value="noimg">缺图片</option><option value="nostock">库存为0</option><option value="nosizestock">未分配尺码</option><option value="nodesc">缺描述</option><option value="demo">测试商品</option></select>
            </div>
            {/* Quick filter buttons */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[{k:"noimg",l:"缺图片"},{k:"nosizestock",l:"未分配尺码"},{k:"nostock",l:"库存为0"},{k:"demo",l:"测试商品"}].map(b => (
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

            {/* Table */}
            <div className="overflow-x-auto">
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
        {tab === "add" ? (
          <form className="flex flex-col gap-5" onSubmit={submitProduct}>
            {/* Basic info card */}
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-ink">基础信息</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="SKU">
                  <div className="flex gap-1.5">
                    <input className="input flex-1" required value={form.sku} onChange={e => updateField("sku", e.target.value)} />
                    <button className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-[11px] font-bold hover:bg-stone-50 whitespace-nowrap" onClick={generateNextSku} type="button">生成编号</button>
                  </div>
                  <p className="mt-1 text-[10px] text-stone-400">切换分类自动生成前缀: {skuPrefix(form.category, form.subcategory)}001</p>
                </Field>
                <Field label="分类"><select className="input" value={form.category} onChange={e => updateField("category", e.target.value as ProductCategory)}>{(dbCats.length > 0 ? dbCats : categories.map(c => ({slug:c.slug}))).map((c:Record<string,unknown>) => <option key={String(c.slug)} value={String(c.slug)}>{String(c.slug)}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" value={form.subcategory} onChange={e => updateField("subcategory", e.target.value)}>{(() => { if (dbSubs.length > 0) { const cat = dbCats.find(x => String(x.slug) === form.category); const list = cat ? dbSubs.filter(s => String(s.category_id) === String(cat.id)) : []; return list.map((s: Record<string, unknown>) => <option key={String(s.slug)} value={String(s.slug)}>{String(s.slug)}</option>); } if (form.category in subcategoryList) { return subcategoryList[form.category].map(s => <option key={s} value={s}>{s}</option>); } return null; })()}</select></Field>
                <Field label="价格"><input className="input" min="0" step="0.01" type="number" value={form.price} onChange={e => updateField("price", Number(e.target.value))} /></Field>
                <Field label="库存">
                  {Object.keys(sizeStock).length > 0 ? (
                    <div>
                      <input className="input bg-stone-50 text-stone-500 cursor-not-allowed" min="0" step="1" type="number" value={Object.values(sizeStock).reduce((a,b)=>a+b,0)} readOnly />
                      <p className="mt-1 text-[10px] text-stone-400">由尺码库存自动计算</p>
                    </div>
                  ) : (
                    <input className="input" min="0" step="1" type="number" value={form.stock} onChange={e => updateField("stock", Number(e.target.value))} />
                  )}
                </Field>
                <Field label="尺码">
                  {Object.keys(sizeStock).length > 0 ? (
                    <div>
                      <input className="input bg-stone-50 text-stone-500 cursor-not-allowed" value={sortSizeKeys(Object.keys(sizeStock)).join(",")} readOnly />
                      <p className="mt-1 text-[10px] text-stone-400">由下方尺码库存自动同步</p>
                    </div>
                  ) : (
                    <input className="input" value={form.sizes} onChange={e => updateField("sizes", e.target.value)} />
                  )}
                </Field>
                <Field label="上架"><select className="input" value={form.is_active ? "true" : "false"} onChange={e => updateField("is_active", e.target.value === "true")}><option value="true">是</option><option value="false">否</option></select></Field>
              </div>
            </section>

            {/* Size-Stock card */}
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-base font-black text-ink">尺码库存</h2>
              <p className="mb-3 text-xs text-stone-500">库存为 0 的尺码在前台显示为售罄。总库存由尺码库存自动计算。</p>
              {editingId && Object.keys(sizeStock).length === 0 && form.sizes.trim() ? <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">该商品还没有尺码库存。旧总库存为 <b>{form.stock}</b>，sizes 为 "{form.sizes}"。请手动分配库存到各尺码后保存，保存后将自动计算总库存。</p> : null}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(form.category === "shoes"
                  ? ["35","36","37","38","39","40","41","42","43","44","45"]
                  : ["XS","S","M","L","XL","XXL","XXXL"]
                ).map(s => <button key={s} className="rounded border border-stone-200 px-2 py-1 text-[11px] font-bold hover:bg-stone-100" onClick={() => addSize(s)} type="button">{s}</button>)}
                <button className="rounded border border-dashed border-stone-300 px-2 py-1 text-[11px] font-bold text-stone-400 hover:border-stone-400" onClick={toggleSizeSummary} type="button">查看 sizes 尺码库存</button>
                <button className="rounded border border-dashed border-stone-300 px-2 py-1 text-[11px] font-bold text-stone-400 hover:border-stone-400" onClick={addCustomSize} type="button">+ 自定义</button>
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
                          <td className="py-1.5 px-3 text-right"><button className="text-[11px] font-bold text-red-500 hover:text-red-700" onClick={() => setSizeStock(prev => { const n = { ...prev }; delete n[sz]; return n; })} type="button">×</button></td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-stone-400">请选择尺码并填写库存。库存为 0 的尺码前台显示为售罄。</p>}
              {Object.keys(sizeStock).length > 0 ? <p className="mt-2 text-xs text-stone-500">总库存（所有尺码合计）：{Object.values(sizeStock).reduce((a,b)=>a+b,0)}，保存时自动同步到基础信息的库存和 sizes 字段。</p> : null}
            </section>

            {/* i18n card */}
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-ink">多语言内容</h2>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-3"><Field label="中文名"><input className="input" value={form.name_cn} onChange={e => updateField("name_cn", e.target.value)} /></Field><Field label="中文描述"><textarea className="input min-h-24" value={form.description_cn} onChange={e => updateField("description_cn", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="希腊语名"><input className="input" value={form.name_gr} onChange={e => updateField("name_gr", e.target.value)} /></Field><Field label="希腊语描述"><textarea className="input min-h-24" value={form.description_gr} onChange={e => updateField("description_gr", e.target.value)} /></Field></div>
                <div className="space-y-3"><Field label="英文名"><input className="input" value={form.name_en} onChange={e => updateField("name_en", e.target.value)} /></Field><Field label="英文描述"><textarea className="input min-h-24" value={form.description_en} onChange={e => updateField("description_en", e.target.value)} /></Field></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" disabled={translating} onClick={() => void translateProduct()} type="button">{translating ? "翻译中..." : "自动翻译"}</button>
                {editingId ? <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={() => { setEditingId(null); setForm(emptyProduct); }} type="button">取消编辑</button> : null}
              </div>
            </section>

            {/* AI 导购信息 card */}
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
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
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-ink">图片与链接</h2>

              {/* Inline upload — only when editing */}
              {editingId ? (
                <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="text-sm font-black text-ink">上传图片到当前商品</h3>
                  <p className="mt-1 text-xs text-stone-500">直接上传主图或多图，自动写入商品字段。</p>
                  <p className="mt-1 text-[10px] text-amber-700">Skroutz 要求图片至少一边 ≥ 1000px，建议 1200×1200 以上。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold hover:bg-stone-50">
                      上传主图
                      <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" disabled={loading} onChange={e => { void uploadImages(e.target.files, { sku: form.sku, mode: "main" }); e.currentTarget.value = ""; }} type="file" />
                    </label>
                    <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold hover:bg-stone-50">
                      上传多图
                      <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" disabled={loading} multiple onChange={e => { void uploadImages(e.target.files, { sku: form.sku, mode: "gallery" }); e.currentTarget.value = ""; }} type="file" />
                    </label>
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
                  <div className="flex gap-2">
                    <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold hover:bg-stone-50">选择主图<input accept="image/*" className="hidden" type="file" onChange={e => setNewMainFile(e.target.files?.[0] || null)} /></label>
                    <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold hover:bg-stone-50">选择多图<input accept="image/*" className="hidden" multiple type="file" onChange={e => setNewGalleryFiles(e.target.files ? Array.from(e.target.files) : [])} /></label>
                    {(newMainFile || newGalleryFiles.length > 0) ? <button className="rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-50" onClick={() => { setNewMainFile(null); setNewGalleryFiles([]); }} type="button">清除</button> : null}
                  </div>
                  {newMainFile ? <p className="mt-2 text-xs text-stone-500">主图: {newMainFile.name}</p> : null}
                  {newGalleryFiles.length > 0 ? <p className="mt-1 text-xs text-stone-500">多图: {newGalleryFiles.map(f=>f.name).join(", ")}</p> : null}
                </div>
              )}

              {/* URL fields */}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="主图 URL"><input className="input" value={form.image_url} onChange={e => updateField("image_url", e.target.value)} /></Field>
                <Field label="Skroutz URL"><input className="input" placeholder="https://www.skroutz.gr/..." value={form.skroutz_url} onChange={e => updateField("skroutz_url", e.target.value)} /></Field>
                <Field label="品牌（可选）"><input className="input" value={form.brand} onChange={e => updateField("brand", e.target.value)} placeholder="如无可留空" /></Field>
                <Field label="条码 / EAN（可选）"><input className="input" value={form.barcode} onChange={e => updateField("barcode", e.target.value)} placeholder="如无可留空" /></Field>
                <Field label="VAT"><input className="input" min="0" step="0.01" type="number" value={form.vat} onChange={e => updateField("vat", Number(e.target.value))} /></Field>
                {/* color hidden — images show color, keep DB field */}
              </div>
              <div className="mt-3"><Field label="多图 URL（一行一个，可用逗号分隔）"><textarea className="input min-h-24" value={form.image_urls} onChange={e => updateField("image_urls", e.target.value)} /></Field></div>
            </section>

            {/* Save buttons — sticky at bottom */}
            <div className="sticky bottom-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-stone-200 bg-white/95 backdrop-blur p-4 shadow-md z-10">
              <div className="flex flex-wrap gap-3">
                <button className="rounded-lg bg-ink px-10 py-3 text-sm font-bold text-white hover:bg-stone-800 shadow-sm" disabled={loading} type="submit">{editingId ? "保存修改" : "新增商品"}</button>
                {editingId ? <button className="rounded-lg border border-stone-200 px-6 py-3 text-sm font-bold text-ink hover:bg-stone-50" onClick={() => { setEditingId(null); setForm(emptyProduct); setSizeStock({}); setTab("dashboard"); }} type="button">取消编辑</button> : null}
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
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-black text-ink">CSV 批量导入</h2>
            <p className="mb-4 text-xs text-stone-500">SKU 已存在则更新，不存在则新增。中文商品自动翻译英文和希腊语。</p>
            <div className="flex flex-wrap gap-2 mb-4">
              <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={downloadCsvTemplate} type="button">下载 CSV 模板</button>
              <button className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white hover:bg-stone-800 disabled:opacity-50" disabled={csvRows.length === 0 || loading} onClick={confirmImportCsv} type="button">导入 CSV</button>
            </div>
            <input accept=".csv,text/csv" className="input" onChange={e => void handleCsv(e.target.files?.[0] || null)} type="file" />
            <p className="mt-2 text-xs text-stone-400">字段：{csvFields.join(", ")}</p>
            {csvRows.length > 0 ? (
              <div className="mt-4">
                <p className="text-sm font-bold text-ink">预览：有效 {csvSummary.valid}，错误 {csvSummary.invalid}{csvSummary.needsTranslation > 0 ? `，需翻译 ${csvSummary.needsTranslation}` : ""}</p>
                <ResultTable results={csvRows.map(r => { const errs = validatePreviewRow(r); let msg = errs.length === 0 ? "OK" : errs.join("; "); if (errs.length === 0) { const nc = String(r.name_cn||"").trim(), dc = String(r.description_cn||"").trim(); if (nc||dc) { const ne = String(r.name_en||"").trim(), de = String(r.description_en||"").trim(), ng = String(r.name_gr||"").trim(), dg = String(r.description_gr||"").trim(); msg = ne&&de&&ng&&dg ? "OK，无需翻译" : "OK，需翻译"; } } return { rowNumber: Number(r.rowNumber), sku: String(r.sku||""), ok: errs.length === 0, message: msg }; })} />
              </div>
            ) : null}
            {csvResults.length > 0 ? <ResultTable results={csvResults} /> : null}
          </section>
        ) : null}

        {/* ── TAB: Bulk Images ──────────────────────────────── */}
        {tab === "images" ? (
          <section className="flex flex-col gap-5">
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-black text-ink">选择商品上传</h2>
              <p className="mb-3 text-xs text-stone-500">用分类和搜索筛选商品，再上传主图或多图。Skroutz 建议图片最长边 1000-1600px。</p>
              <div className="mb-3 grid gap-2 md:grid-cols-4">
                <input className="input" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部分类</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select>
                <select className="input" value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat && isProductCategory(filterCat) ? subcategoryList[filterCat].map(s => <option key={s} value={s}>{s}</option>) : null}</select>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block"><span className="text-sm font-bold text-ink">商品</span><select className="input mt-2" value={selectedImageSku} onChange={e => setSelectedImageSku(e.target.value)}><option value="">选择商品 SKU</option>{filteredProducts.map(p => <option key={p.id} value={p.sku}>{p.sku} - {p.name_cn || p.name_gr || p.name_en || "未命名"} - {p.category}/{p.subcategory}</option>)}</select></label>
                <label className="block"><span className="text-sm font-bold text-ink">上传主图</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2" disabled={!selectedImageSku || loading} onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "main" }); e.currentTarget.value = ""; }} type="file" /></label>
                <label className="block"><span className="text-sm font-bold text-ink">上传多图</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2" disabled={!selectedImageSku || loading} multiple onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "gallery" }); e.currentTarget.value = ""; }} type="file" /></label>
              </div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-black text-ink">按文件名批量上传</h2>
              <p className="mb-3 text-xs text-stone-500">主图文件名：SKU.jpg，例如 women-shirts-001.jpg。多图文件名：SKU-1.jpg、SKU-2.jpg。上传后自动匹配 SKU 并写入商品图片字段。</p>
              <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input" disabled={loading} multiple onChange={e => { void uploadImages(e.target.files); e.currentTarget.value = ""; }} type="file" />
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
            <div className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-ink">Skroutz Feed 状态</h2>
              <p className="mt-1 text-xs text-stone-400">将此 Feed 链接提交给 Skroutz，用于同步商品名称、价格、库存、图片和商品链接。</p>
              <div className="mt-4 flex items-center gap-2">
                {feedStats.noImage === 0 && feedStats.noDesc === 0 && stats.noStock === 0 ? (
                  <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">Feed 状态良好，可以提交给 Skroutz</span>
                ) : (
                  <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                    Feed 有 {(() => { const issues: string[] = []; if (feedStats.noImage > 0) issues.push(`${feedStats.noImage} 个缺图片`); if (feedStats.noDesc > 0) issues.push(`${feedStats.noDesc} 个缺描述`); if (stats.noStock > 0) issues.push(`${stats.noStock} 个库存为0`); return issues.length; })()} 个问题：{(() => { const issues: string[] = []; if (feedStats.noImage > 0) issues.push(`${feedStats.noImage} 个缺图片`); if (feedStats.noDesc > 0) issues.push(`${feedStats.noDesc} 个缺描述`); if (stats.noStock > 0) issues.push(`${stats.noStock} 个库存为0`); return issues.join("，"); })()}
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ label: "Feed 商品数", v: feedStats.total, color: "" }, { label: "缺图片", v: feedStats.noImage, color: feedStats.noImage > 0 ? "" : "" }, { label: "缺描述", v: feedStats.noDesc, color: "" }, { label: "库存为0", v: stats.noStock, color: "" }].map(s => (
                <div key={s.label} className="rounded-xl border border-stone-100 bg-white p-5 text-center shadow-sm">
                  <p className={`text-2xl font-black ${(s.label === "缺图片"||s.label==="缺描述") && s.v > 0 ? "text-amber-600" : s.label === "库存为0" && s.v > 0 ? "text-red-500" : "text-ink"}`}>{s.v}</p>
                  <p className="mt-1 text-xs font-bold text-stone-400">{s.label}</p>
                  {s.label === "缺图片" ? <p className="mt-1 text-[10px] text-stone-400">缺图片影响商品展示</p> : null}
                  {s.label === "缺描述" ? <p className="mt-1 text-[10px] text-stone-400">缺描述影响信息完整度</p> : null}
                  {s.label === "库存为0" ? <p className="mt-1 text-[10px] text-stone-400">库存为0可能无法售卖</p> : null}
                </div>
              ))}
            </div>

            {/* Feed link card */}
            <div className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-black text-ink">Feed 地址</h3>
              <p className="mt-1 text-xs text-stone-400">将此链接复制到 Skroutz 商家后台，用于同步商品名称、价格、库存、图片和链接。</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-4">
                <code className="flex-1 text-sm font-mono font-bold text-ink break-all">{typeof window !== "undefined" ? window.location.origin : ""}/feed.xml</code>
                <button className="rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-stone-800 transition" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/feed.xml`); toast("Feed 链接已复制"); }} type="button">复制链接</button>
                <a className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50 transition" href="/feed.xml" rel="noreferrer" target="_blank">打开 Feed</a>
              </div>
            </div>

            {/* Quick checks */}
            <div className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-black text-ink">Feed 检查</h3>
              <p className="mt-1 text-xs text-stone-400">快速查看需要处理的商品，点击按钮跳转到商品列表并筛选。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[{k:"noimg",l:"查看缺图片商品"},{k:"nodesc",l:"查看缺描述商品"},{k:"nosizestock",l:"查看未分尺码商品"},{k:"nostock",l:"查看库存为0商品"}].map(b => (
                  <button key={b.k} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50 transition" onClick={() => { setFilterStatus(b.k); setTab("dashboard"); }} type="button">{b.l}</button>
                ))}
              </div>
            </div>

            {/* How to use */}
            <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-5 shadow-sm">
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

  function subForCat(catId: string) { return subs.filter(s => s.category_id === catId); }

  return (
    <section className="flex flex-col gap-5">
      {/* 一级分类 */}
      <div className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-black text-ink">一级分类</h2><button className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold hover:bg-stone-50" onClick={addCat} type="button">+ 新增</button></div>
        <p className="mb-3 text-xs text-stone-400">slug 只允许小写英文和横线。停用后前台不再显示，但已有商品不受影响。</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="bg-stone-50/80 text-stone-400"><th className="py-2 px-2 text-xs font-bold">slug</th><th className="py-2 px-2 text-xs font-bold">中文</th><th className="py-2 px-2 text-xs font-bold">English</th><th className="py-2 px-2 text-xs font-bold">Ελληνικά</th><th className="py-2 px-2 text-xs font-bold w-14">排序</th><th className="py-2 px-2 text-xs font-bold w-12">启用</th><th className="py-2 px-2 text-xs font-bold w-12">删除</th></tr></thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={i} className="border-t border-stone-50">
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs font-mono" value={String(c.slug||"")} onChange={e => updateCat(i, "slug", e.target.value.replace(/[^a-z0-9-]/g,"").toLowerCase())} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs" value={String(c.name_cn||"")} onChange={e => updateCat(i, "name_cn", e.target.value)} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs" value={String(c.name_en||"")} onChange={e => updateCat(i, "name_en", e.target.value)} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs" value={String(c.name_gr||"")} onChange={e => updateCat(i, "name_gr", e.target.value)} /></td>
                <td className="py-1.5 px-2"><input className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs text-center" type="number" value={Number(c.sort_order||0)} onChange={e => updateCat(i, "sort_order", parseInt(e.target.value)||0)} /></td>
                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={c.is_active !== false} onChange={e => updateCat(i, "is_active", e.target.checked)} /></td>
                <td className="py-1.5 px-2 text-center"><button className="text-xs font-bold text-red-400 hover:text-red-600" onClick={() => removeCat(i)} type="button">×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* 二级分类 */}
      <div className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-black text-ink">二级分类</h2>
        {cats.filter(c => c.is_active !== false).map((c, ci) => { const catId = String(c.id||""); const catSubs = subForCat(catId); const isOpen = !collapsed.has(catId) && (ci === 0 || collapsed.size <= ci); return (
          <div key={catId} className="mb-3 last:mb-0 border border-stone-100 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between bg-stone-50 px-3 py-2 cursor-pointer" onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(catId)) n.delete(catId); else n.add(catId); return n; })}>
              <h3 className="text-sm font-bold text-ink">{String(c.name_cn||c.name_en||c.slug)} <span className="text-xs text-stone-400 font-normal">({String(c.slug)}) — {catSubs.length} 个二级分类</span></h3>
              <div className="flex items-center gap-2">
                <button className="rounded border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold hover:bg-stone-100" onClick={e => { e.stopPropagation(); addSub(catId); }} type="button">+ 新增</button>
                <span className="text-xs text-stone-400">{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>
            {isOpen && catSubs.length > 0 ? (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead><tr className="bg-stone-50/80 text-stone-400"><th className="py-1.5 px-2 text-[11px] font-bold">slug</th><th className="py-1.5 px-2 text-[11px] font-bold">中文</th><th className="py-1.5 px-2 text-[11px] font-bold">English</th><th className="py-1.5 px-2 text-[11px] font-bold">Ελληνικά</th><th className="py-1.5 px-2 text-[11px] font-bold w-12">排序</th><th className="py-1.5 px-2 text-[11px] font-bold w-10">启用</th><th className="py-1.5 px-2 text-[11px] font-bold w-10">删除</th></tr></thead>
                <tbody>
                  {catSubs.map((s, si) => { const gi = subs.findIndex(x => x === s); return (
                    <tr key={gi} className="border-t border-stone-50">
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-[11px] font-mono" value={String(s.slug||"")} onChange={e => updateSub(gi, "slug", e.target.value.replace(/[^a-z0-9_-]/g,"").toLowerCase())} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-[11px]" value={String(s.name_cn||"")} onChange={e => updateSub(gi, "name_cn", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-[11px]" value={String(s.name_en||"")} onChange={e => updateSub(gi, "name_en", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-[11px]" value={String(s.name_gr||"")} onChange={e => updateSub(gi, "name_gr", e.target.value)} /></td>
                      <td className="py-1 px-2"><input className="w-full rounded border border-stone-200 px-1 py-0.5 text-[11px] text-center" type="number" value={Number(s.sort_order||0)} onChange={e => updateSub(gi, "sort_order", parseInt(e.target.value)||0)} /></td>
                      <td className="py-1 px-2 text-center"><input type="checkbox" checked={s.is_active !== false} onChange={e => updateSub(gi, "is_active", e.target.checked)} /></td>
                      <td className="py-1 px-2 text-center"><button className="text-[11px] font-bold text-red-400 hover:text-red-600" onClick={() => removeSub(gi)} type="button">×</button></td>
                    </tr>
                  );})}
                </tbody>
              </table></div>
            ) : <p className="text-xs text-stone-400">暂无二级分类</p>}
          </div>
        );})}
      </div>

      <button className="rounded-lg bg-ink px-8 py-3 text-sm font-bold text-white hover:bg-stone-800 transition self-start" onClick={save} disabled={loading}>保存全部</button>
    </section>
  );
}

function ResultTable({ results }: { results: ApiResult[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
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
  );
}
