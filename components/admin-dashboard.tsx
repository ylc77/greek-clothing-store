"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  categories,
  isProductCategory,
  isProductSubcategory,
  subcategoriesByCategory,
  type ProductCategory,
  type ProductFormData,
} from "@/lib/types";
import { useToast } from "@/components/admin-toast";

/* ── Types ───────────────────────────────────────────────── */
type AdminProduct = ProductFormData & { id: string };
type ApiResult = { rowNumber?: number; fileName?: string; sku: string; ok: boolean; message: string; imageUrl?: string; translated?: boolean; translateError?: string };
type CsvRow = Record<string, string | number>;
type TranslationResult = { name_gr: string; description_gr: string; name_en: string; description_en: string };
type ImageUploadOptions = { sku?: string; mode?: "main" | "gallery" };
type ImageDeleteOptions = { sku: string; kind: "main" | "gallery"; index?: number };
type Tab = "dashboard" | "add" | "csv" | "images" | "skroutz";

/* ── Constants ───────────────────────────────────────────── */
const uploadImageWidth = 1200; const uploadImageHeight = 1500; const webpUploadQuality = 0.82;
const emptyProduct: ProductFormData = { sku: "", name_cn: "", name_gr: "", name_en: "", description_cn: "", description_gr: "", description_en: "", category: "men", subcategory: "tshirts", price: 0, stock: 0, sizes: "", image_url: "", image_urls: "", brand: "", barcode: "", vat: 24, color: "", skroutz_url: "", is_active: true };
const csvFields = ["sku","name_cn","description_cn","name_en","description_en","name_gr","description_gr","category","subcategory","price","stock","sizes","image_url","image_urls","brand","barcode","vat","color","skroutz_url","is_active"];
const tabs: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "商品列表" }, { key: "add", label: "新增/编辑" }, { key: "csv", label: "CSV 导入" }, { key: "images", label: "图片上传" }, { key: "skroutz", label: "Skroutz Feed" },
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
  const sample = ["DEMO-WOMEN-DRESSES-001","女士连衣裙","示例中文描述","Women dress","Sample English description","Γυναικείο φόρεμα","Παράδειγμα περιγραφής","women","dresses","29.90","10","S,M,L","","","Helios Wear","","24","black","","true"];
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
function normalizeProduct(p: ProductFormData): ProductFormData {
  return { ...p, sku: p.sku.trim(), name_cn: p.name_cn.trim(), name_gr: p.name_gr.trim(), name_en: p.name_en.trim(), description_cn: p.description_cn.trim(), description_gr: p.description_gr.trim(), description_en: p.description_en.trim(), subcategory: p.subcategory.trim(), price: Number(p.price), stock: Number(p.stock), sizes: p.sizes.trim(), image_url: p.image_url.trim(), image_urls: p.image_urls.split(/[\r?\n,]+/).map(u => u.trim()).filter(Boolean).join("\n"), brand: p.brand.trim(), barcode: p.barcode.trim(), vat: Number(p.vat), color: p.color.trim(), skroutz_url: p.skroutz_url.trim(), is_active: p.is_active };
}
function imageLines(v: string) { return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
function imageOutputName(f: File) { return f.name.replace(/\.[^.]+$/, ".webp"); }
async function canvasToWebpBlob(c: HTMLCanvasElement) { return new Promise<Blob>((res, rej) => { c.toBlob(b => b ? res(b) : rej(new Error("图片压缩失败")), "image/webp", webpUploadQuality); }); }
async function compressImageForUpload(file: File) {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file); const canvas = document.createElement("canvas"); canvas.width = uploadImageWidth; canvas.height = uploadImageHeight;
  const ctx = canvas.getContext("2d"); if (!ctx) { bmp.close(); return file; }
  const sr = bmp.width / bmp.height; const tr = uploadImageWidth / uploadImageHeight;
  const sw = sr > tr ? Math.round(bmp.height * tr) : bmp.width; const sh = sr > tr ? bmp.height : Math.round(bmp.width / tr);
  const sx = Math.max(0, Math.round((bmp.width - sw) / 2)); const sy = Math.max(0, Math.round((bmp.height - sh) / 2));
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, uploadImageWidth, uploadImageHeight); bmp.close();
  const blob = await canvasToWebpBlob(canvas);
  return new File([blob], imageOutputName(file), { type: "image/webp", lastModified: Date.now() });
}

/* ── Main component ──────────────────────────────────────── */
export function AdminDashboard() {
  const { toast } = useToast();
  const [password, setPassword] = useState(""); const [activePassword, setActivePassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct); const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [translating, setTranslating] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]); const [csvResults, setCsvResults] = useState<ApiResult[]>([]);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]); const [selectedImageSku, setSelectedImageSku] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");

  // Search / filter state
  const [search, setSearch] = useState(""); const [filterCat, setFilterCat] = useState(""); const [filterSub, setFilterSub] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | active | inactive | noimg | nostock | demo

  const csvSummary = useMemo(() => {
    const valid = csvRows.filter(r => validatePreviewRow(r).length === 0).length;
    const needs = csvRows.filter(r => { if (validatePreviewRow(r).length > 0) return false; const nc = String(r.name_cn||"").trim(), dc = String(r.description_cn||"").trim(); if (!nc && !dc) return false; const ne = String(r.name_en||"").trim(), de = String(r.description_en||"").trim(), ng = String(r.name_gr||"").trim(), dg = String(r.description_gr||"").trim(); return !(ne && de && ng && dg); }).length;
    return { valid, invalid: csvRows.length - valid, needsTranslation: needs };
  }, [csvRows]);

  // Stats
  const stats = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return { total: products.length, active: products.filter(p => p.is_active).length, noImage: products.filter(p => !p.image_url).length, noStock: products.filter(p => p.stock === 0).length, categories: cats.size };
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
    if (filterStatus === "nostock") list = list.filter(p => p.stock === 0);
    if (filterStatus === "demo") list = list.filter(p => /TEST|DEMO/i.test(p.sku));
    return list;
  }, [products, search, filterCat, filterSub, filterStatus]);

  // Feed stats
  const feedStats = useMemo(() => ({
    total: products.filter(p => p.is_active && p.stock >= 0).length,
    noImage: products.filter(p => p.is_active && p.stock >= 0 && !p.image_url).length,
    noDesc: products.filter(p => p.is_active && p.stock >= 0 && !p.description_en && !p.description_gr).length,
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

  function updateField<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) { setForm(c => { if (key === "category") return { ...c, category: value as ProductCategory, subcategory: subcategoriesByCategory[value as ProductCategory][0] }; return { ...c, [key]: value }; }); }
  function startEdit(p: AdminProduct) { setEditingId(p.id); setForm({ sku:p.sku, name_cn:p.name_cn, name_gr:p.name_gr, name_en:p.name_en, description_cn:p.description_cn, description_gr:p.description_gr, description_en:p.description_en, category:p.category, subcategory:p.subcategory, price:p.price, stock:p.stock, sizes:p.sizes, image_url:p.image_url, image_urls:p.image_urls, brand:p.brand, barcode:p.barcode, vat:p.vat, color:p.color, skroutz_url:p.skroutz_url, is_active:p.is_active }); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function copyProduct(p: AdminProduct) { setEditingId(null); setForm({ ...p, sku: p.sku + "-COPY" }); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); }

  /* ── Translate ────────────────────────────────────────── */
  async function translateProduct() {
    if (!form.name_cn.trim() && !form.description_cn.trim()) { toast("请先填写中文名称或中文描述。", "err"); return; }
    if ((form.name_gr || form.description_gr || form.name_en || form.description_en) && !window.confirm("当前已有希腊语或英语内容，是否用自动翻译结果覆盖？")) return;
    setTranslating(true);
    try { const d = await api("/api/admin/translate", { method: "POST", body: JSON.stringify({ name_cn: form.name_cn, description_cn: form.description_cn }) }) as TranslationResult; setForm(c => ({ ...c, name_gr: d.name_gr, description_gr: d.description_gr, name_en: d.name_en, description_en: d.description_en })); toast("翻译已生成，请检查后再保存。"); } catch (e) { toast(e instanceof Error ? e.message : "自动翻译失败", "err"); } finally { setTranslating(false); }
  }

  /* ── Submit / Delete ──────────────────────────────────── */
  async function submitProduct(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setLoading(true); const p = normalizeProduct(form); const url = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products"; const method = editingId ? "PUT" : "POST"; try { await api(url, { method, body: JSON.stringify(p) }); toast(editingId ? "商品已更新" : "商品已新增"); setForm(emptyProduct); setEditingId(null); setTab("dashboard"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "保存失败", "err"); } finally { setLoading(false); } }
  async function deleteProduct(p: AdminProduct) { if (!window.confirm(`删除商品 ${p.sku}?`)) return; setLoading(true); try { await api(`/api/admin/products/${p.id}`, { method: "DELETE" }); toast("商品已删除"); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "删除失败", "err"); } finally { setLoading(false); } }

  /* ── CSV ──────────────────────────────────────────────── */
  async function handleCsv(f: File | null) { setCsvResults([]); if (!f) { setCsvRows([]); return; } setCsvRows(parseCsv(await f.text())); }
  async function importCsv() { if (csvSummary.needsTranslation > 20) { if (!window.confirm(`有 ${csvSummary.needsTranslation} 行需要自动翻译，将调用 DeepSeek API 约 ${Math.ceil(csvSummary.needsTranslation / 3)} 次。是否继续？`)) return; } setLoading(true); try { const d = await api("/api/admin/products/import", { method: "POST", body: JSON.stringify({ rows: csvRows }) }); setCsvResults(d.results||[]); toast(`CSV 导入完成：成功 ${d.successCount}，失败 ${d.failureCount}${d.translatedCount>0?`，翻译成功 ${d.translatedCount}`:""}${d.translateFailureCount>0?`，翻译失败 ${d.translateFailureCount}`:""}`); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "CSV 导入失败", "err"); } finally { setLoading(false); } }

  /* ── Image upload ──────────────────────────────────────── */
  async function uploadImages(files: FileList | null, opts: ImageUploadOptions = {}) { setImageResults([]); if (!files || files.length === 0) return; if (opts.sku && !opts.mode) { toast("请选择上传类型。", "err"); return; } try { setLoading(true); const body = new FormData(); const optimized = await Promise.all(Array.from(files).map(compressImageForUpload)); optimized.forEach(f => body.append("images", f)); if (opts.sku) body.append("sku", opts.sku); if (opts.mode) body.append("mode", opts.mode); const r = await fetch("/api/admin/images", { method: "POST", headers: { "x-admin-password": activePassword }, body }); const d = await readJson(r, "图片上传接口错误"); if (!r.ok) throw new Error(d.error || "图片上传失败"); setImageResults(d.results||[]); toast(`图片处理完成：成功 ${d.successCount}，失败 ${d.failureCount}`); await loadProducts(); } catch (er) { toast(er instanceof Error ? er.message : "图片上传失败", "err"); } finally { setLoading(false); } }
  async function deleteImage(opts: ImageDeleteOptions) { const label = opts.kind === "main" ? "主图" : "这张多图"; if (!window.confirm(`确定删除${label}吗？`)) return; setLoading(true); try { const r = await fetch("/api/admin/images", { method: "DELETE", headers: { "Content-Type": "application/json", "x-admin-password": activePassword }, body: JSON.stringify(opts) }); const d = await readJson(r, "删除图片接口错误"); if (!r.ok) throw new Error(d.error || "删除图片失败"); toast(`${label}已删除。`); await loadProducts(); if (editingId && form.sku === opts.sku) { setForm(c => { if (opts.kind === "main") return { ...c, image_url: "" }; const next = imageLines(c.image_urls).filter((_, i) => i !== opts.index); return { ...c, image_urls: next.join("\n") }; }); } } catch (er) { toast(er instanceof Error ? er.message : "删除图片失败", "err"); } finally { setLoading(false); } }

  /* ── Login gate ─────────────────────────────────────────── */
  if (!activePassword) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <section className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm text-center">
          <div className="mb-6">
            <svg className="mx-auto h-10 w-10 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
          <h1 className="text-xl font-black text-ink">商品管理后台</h1>
          <p className="mt-2 text-sm text-stone-500">Helios Wear Admin</p>
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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ── Top bar ────────────────────────────────────── */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
          <div>
            <h1 className="text-2xl font-black text-ink">商品管理后台</h1>
            <p className="text-xs text-stone-500">管理商品、图片、CSV 导入和 Skroutz Feed</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" href="/admin/settings">店铺设置</a>
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => { fetch("/api/admin/backup", { headers: { "x-admin-password": activePassword } }).then(r => r.blob()).then(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `products-export-${new Date().toISOString().split("T")[0]}.csv`; a.click(); }).catch(() => toast("备份下载失败", "err")); }} type="button">导出 CSV</button>
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-ink hover:bg-stone-50" onClick={() => { setActivePassword(""); setPassword(""); }}>退出</button>
          </div>
        </header>

        {/* ── Stats cards ────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[{ label: "商品总数", v: stats.total }, { label: "已上架", v: stats.active }, { label: "缺图片", v: stats.noImage }, { label: "库存为0", v: stats.noStock }, { label: "分类数", v: stats.categories }].map(s => (
            <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-4 text-center shadow-sm">
              <p className="text-2xl font-black text-ink">{s.v}</p>
              <p className="mt-1 text-xs font-bold text-stone-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tab bar ─────────────────────────────────────── */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-stone-200 bg-white p-1 shadow-sm">
          {tabs.map(t => (
            <button key={t.key} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold transition ${tab === t.key ? "bg-ink text-white" : "text-stone-500 hover:text-ink hover:bg-stone-100"}`} onClick={() => setTab(t.key)} type="button">{t.label}</button>
          ))}
        </nav>

        {/* ── TAB: Dashboard ──────────────────────────────── */}
        {tab === "dashboard" ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            {/* Search bar */}
            <div className="mb-4 grid gap-3 md:grid-cols-5">
              <input className="input md:col-span-2" placeholder="搜索 SKU / 商品名..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="input" value={filterCat} onChange={e => { setFilterCat(e.target.value); setFilterSub(""); }}><option value="">全部分类</option>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select>
              <select className="input" value={filterSub} onChange={e => setFilterSub(e.target.value)}><option value="">全部二级分类</option>{filterCat && isProductCategory(filterCat) ? subcategoriesByCategory[filterCat].map(s => <option key={s} value={s}>{s}</option>) : null}</select>
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">全部状态</option><option value="active">已上架</option><option value="inactive">已下架</option><option value="noimg">缺图片</option><option value="nostock">库存为0</option><option value="demo">测试商品</option></select>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-3 pr-2 text-[11px] font-bold w-14">图片</th><th className="py-3 pr-2 text-[11px] font-bold">SKU</th><th className="py-3 pr-2 text-[11px] font-bold">商品名</th><th className="py-3 pr-2 text-[11px] font-bold">分类</th><th className="py-3 pr-2 text-[11px] font-bold">价格</th><th className="py-3 pr-2 text-[11px] font-bold">库存</th><th className="py-3 pr-2 text-[11px] font-bold">状态</th><th className="py-3 pr-2 text-[11px] font-bold w-36">操作</th>
                </tr></thead>
                <tbody>
                  {filteredProducts.slice(0, 100).map(p => (
                    <tr className="border-b border-stone-50 hover:bg-stone-50/50" key={p.id}>
                      <td className="py-2 pr-2">
                        {p.image_url ? (
                          <ImgThumb src={p.image_url} />
                        ) : (
                          <span className="inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-400">缺图</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 font-mono text-[11px] font-bold text-ink">{p.sku}</td>
                      <td className="py-2 pr-2"><p className="text-xs font-bold text-ink line-clamp-1">{p.name_cn || p.name_en || p.name_gr || "—"}</p><p className="text-[10px] text-stone-400 line-clamp-1">{p.name_en}</p></td>
                      <td className="py-2 pr-2 text-[11px] text-stone-600">{p.category}/{p.subcategory}</td>
                      <td className="py-2 pr-2 text-[11px] font-bold">€{Number(p.price).toFixed(2)}</td>
                      <td className="py-2 pr-2 text-[11px]">{p.stock}</td>
                      <td className="py-2 pr-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${p.is_active ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"}`}>{p.is_active ? "上架" : "下架"}</span></td>
                      <td className="py-2 pr-2"><div className="flex gap-1">
                        <button className="rounded-md border border-stone-200 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap hover:bg-stone-100" onClick={() => startEdit(p)}>编辑</button>
                        <button className="rounded-md border border-stone-200 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap hover:bg-stone-100" onClick={() => copyProduct(p)}>复制</button>
                        <button className="rounded-md border border-red-100 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-red-600 hover:bg-red-50" onClick={() => void deleteProduct(p)}>删除</button>
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
                <Field label="SKU"><input className="input" required value={form.sku} onChange={e => updateField("sku", e.target.value)} /></Field>
                <Field label="分类"><select className="input" value={form.category} onChange={e => updateField("category", e.target.value as ProductCategory)}>{categories.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}</select></Field>
                <Field label="二级分类"><select className="input" value={form.subcategory} onChange={e => updateField("subcategory", e.target.value)}>{subcategoriesByCategory[form.category].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
                <Field label="价格"><input className="input" min="0" step="0.01" type="number" value={form.price} onChange={e => updateField("price", Number(e.target.value))} /></Field>
                <Field label="库存"><input className="input" min="0" step="1" type="number" value={form.stock} onChange={e => updateField("stock", Number(e.target.value))} /></Field>
                <Field label="尺码"><input className="input" placeholder="S,M,L,XL" value={form.sizes} onChange={e => updateField("sizes", e.target.value)} /></Field>
                <Field label="上架"><select className="input" value={form.is_active ? "true" : "false"} onChange={e => updateField("is_active", e.target.value === "true")}><option value="true">是</option><option value="false">否</option></select></Field>
              </div>
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

            {/* Image & links card */}
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-ink">图片与链接</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Field label="主图 URL"><input className="input" value={form.image_url} onChange={e => updateField("image_url", e.target.value)} /></Field>
                <Field label="Skroutz URL"><input className="input" placeholder="https://www.skroutz.gr/..." value={form.skroutz_url} onChange={e => updateField("skroutz_url", e.target.value)} /></Field>
                <Field label="品牌"><input className="input" value={form.brand} onChange={e => updateField("brand", e.target.value)} /></Field>
                <Field label="条码 / EAN"><input className="input" value={form.barcode} onChange={e => updateField("barcode", e.target.value)} /></Field>
                <Field label="VAT"><input className="input" min="0" step="0.01" type="number" value={form.vat} onChange={e => updateField("vat", Number(e.target.value))} /></Field>
                <Field label="颜色"><input className="input" value={form.color} onChange={e => updateField("color", e.target.value)} /></Field>
              </div>
              <div className="mt-3"><Field label="多图 URL（一行一个，可用逗号分隔）"><textarea className="input min-h-24" value={form.image_urls} onChange={e => updateField("image_urls", e.target.value)} /></Field></div>

              {editingId ? (
                <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="text-sm font-black text-ink">当前图片</h3>
                  <p className="mt-1 text-xs text-stone-500">删除会同步清理 Supabase Storage</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div><p className="mb-2 text-xs font-bold text-stone-600">主图</p>{form.image_url ? <ImagePreview disabled={loading} url={form.image_url} label="主图" onDel={() => void deleteImage({ sku: form.sku, kind: "main" })} /> : <div className="flex aspect-[4/5] items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-xs text-stone-400">无主图</div>}</div>
                    <div><p className="mb-2 text-xs font-bold text-stone-600">多图</p>{imageLines(form.image_urls).length > 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{imageLines(form.image_urls).map((u, i) => <ImagePreview key={`${u}-${i}`} disabled={loading} url={u} label={`多图 ${i + 1}`} onDel={() => void deleteImage({ sku: form.sku, kind: "gallery", index: i })} />)}</div> : <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-xs text-stone-400">无多图</div>}</div>
                  </div>
                </div>
              ) : null}
            </section>

            <button className="rounded-lg bg-ink px-8 py-3 text-sm font-bold text-white hover:bg-stone-800 self-start" disabled={loading}>{editingId ? "保存修改" : "新增商品"}</button>
          </form>
        ) : null}

        {/* ── TAB: CSV ────────────────────────────────────── */}
        {tab === "csv" ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-black text-ink">CSV 批量导入</h2>
            <p className="mb-4 text-xs text-stone-500">SKU 已存在则更新，不存在则新增。中文商品自动翻译英文和希腊语。</p>
            <div className="flex flex-wrap gap-2 mb-4">
              <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={downloadCsvTemplate} type="button">下载 CSV 模板</button>
              <button className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white hover:bg-stone-800 disabled:opacity-50" disabled={csvRows.length === 0 || loading} onClick={importCsv} type="button">导入 CSV</button>
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

        {/* ── TAB: Images ─────────────────────────────────── */}
        {tab === "images" ? (
          <section className="flex flex-col gap-5">
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-black text-ink">选择商品上传</h2>
              <p className="mb-3 text-xs text-stone-500">不用改文件名，选商品即可上传主图或多图。</p>
              <div className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block"><span className="text-sm font-bold text-ink">商品</span><select className="input mt-2" value={selectedImageSku} onChange={e => setSelectedImageSku(e.target.value)}><option value="">选择商品 SKU</option>{products.map(p => <option key={p.id} value={p.sku}>{p.sku} - {p.name_cn || p.name_gr || p.name_en || "未命名"}</option>)}</select></label>
                <label className="block"><span className="text-sm font-bold text-ink">上传主图</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2" disabled={!selectedImageSku || loading} onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "main" }); e.currentTarget.value = ""; }} type="file" /></label>
                <label className="block"><span className="text-sm font-bold text-ink">上传多图</span><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input mt-2" disabled={!selectedImageSku || loading} multiple onChange={e => { void uploadImages(e.target.files, { sku: selectedImageSku, mode: "gallery" }); e.currentTarget.value = ""; }} type="file" /></label>
              </div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-lg font-black text-ink">按文件名批量上传</h2>
              <p className="mb-3 text-xs text-stone-500">主图：SKU.jpg；多图：SKU-1.jpg、SKU-2.jpg</p>
              <input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="input" disabled={loading} multiple onChange={e => { void uploadImages(e.target.files); e.currentTarget.value = ""; }} type="file" />
            </div>
            {imageResults.length > 0 ? <ResultTable results={imageResults} /> : null}
          </section>
        ) : null}

        {/* ── TAB: Skroutz Feed ───────────────────────────── */}
        {tab === "skroutz" ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-black text-ink">Skroutz Feed 状态</h2>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ label: "Feed 商品数", v: feedStats.total }, { label: "缺图片", v: feedStats.noImage }, { label: "缺描述", v: feedStats.noDesc }].map(s => (
                <div key={s.label} className="rounded-lg border border-stone-100 bg-stone-50 p-4 text-center"><p className="text-xl font-black text-ink">{s.v}</p><p className="mt-1 text-xs text-stone-500">{s.label}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-stone-50 p-4">
              <code className="text-sm font-bold text-ink break-all">/feed.xml</code>
              <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/feed.xml`); toast("Feed 链接已复制"); }} type="button">复制链接</button>
              <a className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold hover:bg-stone-50" href="/feed.xml" rel="noreferrer" target="_blank">预览 Feed</a>
            </div>
          </section>
        ) : null}

      </div>
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
