"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  categories,
  isProductCategory,
  isProductSubcategory,
  subcategoriesByCategory,
  type ProductCategory,
  type ProductFormData
} from "@/lib/types";

type AdminProduct = ProductFormData & {
  id: string;
};

type ApiResult = {
  rowNumber?: number;
  fileName?: string;
  sku: string;
  ok: boolean;
  message: string;
  imageUrl?: string;
};

type CsvRow = Record<string, string | number>;

const emptyProduct: ProductFormData = {
  sku: "",
  name_cn: "",
  name_gr: "",
  name_en: "",
  description_cn: "",
  description_gr: "",
  description_en: "",
  category: "men",
  subcategory: "tshirts",
  price: 0,
  stock: 0,
  sizes: "",
  image_url: "",
  image_urls: "",
  brand: "",
  barcode: "",
  vat: 24,
  color: "",
  additional_image_urls: ""
};

const csvFields = [
  "sku",
  "name_cn",
  "description_cn",
  "name_en",
  "description_en",
  "name_gr",
  "description_gr",
  "category",
  "subcategory",
  "price",
  "stock",
  "sizes",
  "image_url",
  "brand",
  "barcode",
  "vat",
  "color",
  "additional_image_urls"
];

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim()) || [];

  return rows.map((values, index) => {
    const output: CsvRow = { rowNumber: index + 2 };
    headers.forEach((header, headerIndex) => {
      output[header] = values[headerIndex] || "";
    });
    return output;
  });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsvTemplate() {
  const sampleRow = [
    "DEMO-WOMEN-DRESSES-001",
    "女士连衣裙",
    "示例中文描述",
    "Women Dress",
    "Sample English description",
    "Γυναικείο φόρεμα",
    "Παράδειγμα περιγραφής",
    "women",
    "dresses",
    "29.90",
    "10",
    "S/M/L",
    "",
    "Helios Wear",
    "",
    "24",
    "black",
    ""
  ];
  const csv = `${csvFields.join(",")}\n${sampleRow.map(csvCell).join(",")}\n`;
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "products-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validatePreviewRow(row: CsvRow) {
  const errors: string[] = [];
  const sku = String(row.sku || "").trim();
  const category = String(row.category || "").trim();
  const subcategory = String(row.subcategory || "").trim();
  const price = Number(String(row.price || "").replace(",", "."));
  const stock = Number(String(row.stock || "").replace(",", "."));
  const vat = row.vat === undefined || row.vat === "" ? 24 : Number(String(row.vat).replace(",", "."));

  if (!sku) errors.push("sku 必填");
  if (!isProductCategory(category)) errors.push("分类无效");
  if (isProductCategory(category) && subcategory && !isProductSubcategory(category, subcategory)) {
    errors.push("二级分类无效");
  }
  if (!Number.isFinite(price)) errors.push("价格必须是数字");
  if (!Number.isFinite(stock)) errors.push("库存必须是数字");
  if (!Number.isFinite(vat)) errors.push("VAT must be a number");

  return errors;
}

function normalizeProduct(product: ProductFormData): ProductFormData {
  return {
    ...product,
    sku: product.sku.trim(),
    name_cn: product.name_cn.trim(),
    name_gr: product.name_gr.trim(),
    name_en: product.name_en.trim(),
    description_cn: product.description_cn.trim(),
    description_gr: product.description_gr.trim(),
    description_en: product.description_en.trim(),
    subcategory: product.subcategory.trim(),
    price: Number(product.price),
    stock: Number(product.stock),
    sizes: product.sizes.trim(),
    image_url: product.image_url.trim(),
    image_urls: product.image_urls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
      .join("\n"),
    brand: product.brand.trim(),
    barcode: product.barcode.trim(),
    vat: Number(product.vat),
    color: product.color.trim(),
    additional_image_urls: product.additional_image_urls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
      .join("\n")
  };
}

export function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvResults, setCsvResults] = useState<ApiResult[]>([]);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]);

  const csvSummary = useMemo(() => {
    const valid = csvRows.filter((row) => validatePreviewRow(row).length === 0).length;
    return { valid, invalid: csvRows.length - valid };
  }, [csvRows]);

  async function api(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": activePassword,
        ...(init.headers || {})
      }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  async function loadProducts() {
    setLoading(true);
    setStatus("");

    try {
      const data = await api("/api/admin/products");
      setProducts(data.products || []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "商品读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activePassword) {
      void loadProducts();
    }
  }, [activePassword]);

  function updateField<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((current) => {
      if (key === "category") {
        const category = value as ProductCategory;
        return {
          ...current,
          category,
          subcategory: subcategoriesByCategory[category][0]
        };
      }

      return { ...current, [key]: value };
    });
  }

  function editProduct(product: AdminProduct) {
    setEditingId(product.id);
    setForm({
      sku: product.sku,
      name_cn: product.name_cn,
      name_gr: product.name_gr,
      name_en: product.name_en,
      description_cn: product.description_cn,
      description_gr: product.description_gr,
      description_en: product.description_en,
      category: product.category,
      subcategory: product.subcategory,
      price: product.price,
      stock: product.stock,
      sizes: product.sizes,
      image_url: product.image_url,
      image_urls: product.image_urls,
      brand: product.brand,
      barcode: product.barcode,
      vat: product.vat,
      color: product.color,
      additional_image_urls: product.additional_image_urls
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    const payload = normalizeProduct(form);
    const url = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products";
    const method = editingId ? "PUT" : "POST";

    try {
      await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      setStatus(editingId ? "商品已更新" : "商品已新增");
      setForm(emptyProduct);
      setEditingId(null);
      await loadProducts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProduct(product: AdminProduct) {
    if (!window.confirm(`删除商品 ${product.sku}?`)) {
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      await api(`/api/admin/products/${product.id}`, { method: "DELETE" });
      setStatus("商品已删除");
      await loadProducts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCsv(file: File | null) {
    setCsvResults([]);
    if (!file) {
      setCsvRows([]);
      return;
    }

    const text = await file.text();
    setCsvRows(parseCsv(text));
  }

  async function importCsv() {
    setLoading(true);
    setStatus("");

    try {
      const data = await api("/api/admin/products/import", {
        method: "POST",
        body: JSON.stringify({ rows: csvRows })
      });
      setCsvResults(data.results || []);
      setStatus(`CSV 导入完成：成功 ${data.successCount}，失败 ${data.failureCount}`);
      await loadProducts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "CSV 导入失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadImages(files: FileList | null) {
    setImageResults([]);
    if (!files || files.length === 0) {
      return;
    }

    setLoading(true);
    setStatus("");

    const body = new FormData();
    Array.from(files).forEach((file) => body.append("images", file));

    try {
      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: {
          "x-admin-password": activePassword
        },
        body
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "图片上传失败");
      }

      setImageResults(data.results || []);
      setStatus(`图片处理完成：成功 ${data.successCount}，失败 ${data.failureCount}`);
      await loadProducts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setLoading(false);
    }
  }

  if (!activePassword) {
    return (
      <main className="min-h-screen bg-paper px-4 py-10">
        <section className="mx-auto max-w-md rounded-md border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-ink">商品后台</h1>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setActivePassword(password);
            }}
          >
            <label className="block text-sm font-bold text-ink">
              管理密码
              <input
                className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            <button className="w-full rounded-md bg-ink px-4 py-3 text-sm font-bold text-white">
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <section className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-stone-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ink">商品后台</h1>
            <p className="mt-1 text-sm text-stone-600">Supabase products 管理</p>
          </div>
          <button
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-ink"
            onClick={() => {
              setActivePassword("");
              setPassword("");
            }}
          >
            退出
          </button>
        </header>

        {status ? (
          <div className="rounded-md border border-stone-200 bg-white p-4 text-sm text-ink">
            {status}
          </div>
        ) : null}

        <form className="rounded-md border border-stone-200 bg-white p-5 shadow-sm" onSubmit={submitProduct}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-ink">{editingId ? "编辑商品" : "新增商品"}</h2>
            {editingId ? (
              <button
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-bold"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyProduct);
                }}
                type="button"
              >
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="SKU">
              <input className="input" required value={form.sku} onChange={(event) => updateField("sku", event.target.value)} />
            </Field>
            <Field label="分类">
              <select
                className="input"
                value={form.category}
                onChange={(event) => updateField("category", event.target.value as ProductCategory)}
              >
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.slug}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="二级分类">
              <select
                className="input"
                value={form.subcategory}
                onChange={(event) => updateField("subcategory", event.target.value)}
              >
                {subcategoriesByCategory[form.category].map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="价格">
              <input
                className="input"
                min="0"
                step="0.01"
                type="number"
                value={form.price}
                onChange={(event) => updateField("price", Number(event.target.value))}
              />
            </Field>
            <Field label="库存">
              <input
                className="input"
                min="0"
                step="1"
                type="number"
                value={form.stock}
                onChange={(event) => updateField("stock", Number(event.target.value))}
              />
            </Field>
            <Field label="中文名">
              <input className="input" value={form.name_cn} onChange={(event) => updateField("name_cn", event.target.value)} />
            </Field>
            <Field label="希腊语名">
              <input className="input" value={form.name_gr} onChange={(event) => updateField("name_gr", event.target.value)} />
            </Field>
            <Field label="英文名">
              <input className="input" value={form.name_en} onChange={(event) => updateField("name_en", event.target.value)} />
            </Field>
            <Field label="尺码">
              <input className="input" value={form.sizes} onChange={(event) => updateField("sizes", event.target.value)} />
            </Field>
            <Field label="图片 URL">
              <input className="input" value={form.image_url} onChange={(event) => updateField("image_url", event.target.value)} />
            </Field>
            <Field label="品牌">
              <input className="input" value={form.brand} onChange={(event) => updateField("brand", event.target.value)} />
            </Field>
            <Field label="条码 / EAN">
              <input className="input" value={form.barcode} onChange={(event) => updateField("barcode", event.target.value)} />
            </Field>
            <Field label="VAT">
              <input
                className="input"
                min="0"
                step="0.01"
                type="number"
                value={form.vat}
                onChange={(event) => updateField("vat", Number(event.target.value))}
              />
            </Field>
            <Field label="颜色">
              <input className="input" value={form.color} onChange={(event) => updateField("color", event.target.value)} />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="多图 URL（一行一个）">
              <textarea
                className="input min-h-28"
                value={form.image_urls}
                onChange={(event) => updateField("image_urls", event.target.value)}
                placeholder="https://example.com/front.jpg&#10;https://example.com/back.jpg&#10;https://example.com/detail.jpg"
              />
            </Field>
            <Field label="Skroutz 额外图片 URL（一行一个）">
              <textarea
                className="input min-h-28"
                value={form.additional_image_urls}
                onChange={(event) => updateField("additional_image_urls", event.target.value)}
                placeholder="https://example.com/extra-1.jpg&#10;https://example.com/extra-2.jpg"
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="中文描述">
              <textarea className="input min-h-24" value={form.description_cn} onChange={(event) => updateField("description_cn", event.target.value)} />
            </Field>
            <Field label="希腊语描述">
              <textarea className="input min-h-24" value={form.description_gr} onChange={(event) => updateField("description_gr", event.target.value)} />
            </Field>
            <Field label="英文描述">
              <textarea className="input min-h-24" value={form.description_en} onChange={(event) => updateField("description_en", event.target.value)} />
            </Field>
          </div>

          <button className="mt-5 rounded-md bg-ink px-5 py-3 text-sm font-bold text-white" disabled={loading}>
            {editingId ? "保存修改" : "新增商品"}
          </button>
        </form>

        <section className="rounded-md border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-ink">CSV 批量导入</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold"
                onClick={downloadCsvTemplate}
                type="button"
              >
                下载 CSV 模板
              </button>
              <button
                className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold"
                disabled={csvRows.length === 0 || loading}
                onClick={importCsv}
                type="button"
              >
                导入 CSV
              </button>
            </div>
          </div>
          <input
            accept=".csv,text/csv"
            className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            onChange={(event) => void handleCsv(event.target.files?.[0] || null)}
            type="file"
          />
          <p className="mt-3 text-sm text-stone-600">
            字段：{csvFields.join(", ")}
          </p>
          {csvRows.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-bold text-ink">
                预览：有效 {csvSummary.valid}，错误 {csvSummary.invalid}
              </p>
              <ResultTable
                results={csvRows.map((row) => {
                  const errors = validatePreviewRow(row);
                  return {
                    rowNumber: Number(row.rowNumber),
                    sku: String(row.sku || ""),
                    ok: errors.length === 0,
                    message: errors.length === 0 ? "OK" : errors.join("; ")
                  };
                })}
              />
            </div>
          ) : null}
          {csvResults.length > 0 ? <ResultTable results={csvResults} /> : null}
        </section>

        <section className="rounded-md border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-ink">批量上传商品主图</h2>
          <p className="mt-2 text-sm text-stone-600">文件名必须是 sku.jpg、sku.png 或 sku.webp。</p>
          <input
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="mt-4 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            multiple
            onChange={(event) => void uploadImages(event.target.files)}
            type="file"
          />
          {imageResults.length > 0 ? <ResultTable results={imageResults} /> : null}
        </section>

        <section className="rounded-md border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-ink">商品列表</h2>
            <button
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold"
              disabled={loading}
              onClick={() => void loadProducts()}
              type="button"
            >
              刷新
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-stone-600">
                  <th className="py-3 pr-4">SKU</th>
                  <th className="py-3 pr-4">商品名</th>
                  <th className="py-3 pr-4">分类</th>
                  <th className="py-3 pr-4">二级分类</th>
                  <th className="py-3 pr-4">价格</th>
                  <th className="py-3 pr-4">品牌</th>
                  <th className="py-3 pr-4">颜色</th>
                  <th className="py-3 pr-4">VAT</th>
                  <th className="py-3 pr-4">库存</th>
                  <th className="py-3 pr-4">图片地址</th>
                  <th className="py-3 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr className="border-b border-stone-100" key={product.id}>
                    <td className="py-3 pr-4 font-bold text-ink">{product.sku}</td>
                    <td className="py-3 pr-4">{product.name_cn || product.name_gr || product.name_en}</td>
                    <td className="py-3 pr-4">{product.category}</td>
                    <td className="py-3 pr-4">{product.subcategory}</td>
                    <td className="py-3 pr-4">€{Number(product.price).toFixed(2)}</td>
                    <td className="py-3 pr-4">{product.brand}</td>
                    <td className="py-3 pr-4">{product.color}</td>
                    <td className="py-3 pr-4">{Number(product.vat || 24).toFixed(2)}</td>
                    <td className="py-3 pr-4">{product.stock}</td>
                    <td className="max-w-xs truncate py-3 pr-4">{product.image_url}</td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-stone-300 px-3 py-2 text-xs font-bold"
                          onClick={() => editProduct(product)}
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="rounded-md border border-red-200 px-3 py-2 text-xs font-bold text-red-700"
                          onClick={() => void deleteProduct(product)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-sm font-bold text-ink">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function ResultTable({ results }: { results: ApiResult[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-stone-600">
            <th className="py-2 pr-4">项目</th>
            <th className="py-2 pr-4">SKU</th>
            <th className="py-2 pr-4">状态</th>
            <th className="py-2 pr-4">说明</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr className="border-b border-stone-100" key={`${result.sku}-${result.fileName || result.rowNumber || index}`}>
              <td className="py-2 pr-4">{result.fileName || `第 ${result.rowNumber} 行`}</td>
              <td className="py-2 pr-4">{result.sku}</td>
              <td className={result.ok ? "py-2 pr-4 font-bold text-green-700" : "py-2 pr-4 font-bold text-red-700"}>
                {result.ok ? "成功" : "失败"}
              </td>
              <td className="py-2 pr-4">{result.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
