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
  translated?: boolean;
  translateError?: string;
};

type CsvRow = Record<string, string | number>;

type TranslationResult = {
  name_gr: string;
  description_gr: string;
  name_en: string;
  description_en: string;
};

type ImageUploadOptions = {
  sku?: string;
  mode?: "main" | "gallery";
};

type ImageDeleteOptions = {
  sku: string;
  kind: "main" | "gallery";
  index?: number;
};

const uploadImageWidth = 1200;
const uploadImageHeight = 1500;
const webpUploadQuality = 0.82;

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
  additional_image_urls: "",
  skroutz_url: ""
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
  "image_urls",
  "brand",
  "barcode",
  "vat",
  "color",
  "skroutz_url"
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
    "Women dress",
    "Sample English description",
    "Γυναικείο φόρεμα",
    "Παράδειγμα περιγραφής",
    "women",
    "dresses",
    "29.90",
    "10",
    "S,M,L",
    "",
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
  if (!Number.isFinite(vat)) errors.push("VAT 必须是数字");

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
    additional_image_urls: "",
    skroutz_url: product.skroutz_url.trim()
  };
}

function imageOutputName(file: File) {
  return file.name.replace(/\.[^.]+$/, ".webp");
}

function imageLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function canvasToWebpBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("图片压缩失败"));
        }
      },
      "image/webp",
      webpUploadQuality
    );
  });
}

async function compressImageForUpload(file: File) {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = uploadImageWidth;
  canvas.height = uploadImageHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    return file;
  }

  const sourceRatio = bitmap.width / bitmap.height;
  const targetRatio = uploadImageWidth / uploadImageHeight;
  const sourceWidth = sourceRatio > targetRatio ? Math.round(bitmap.height * targetRatio) : bitmap.width;
  const sourceHeight = sourceRatio > targetRatio ? bitmap.height : Math.round(bitmap.width / targetRatio);
  const sourceX = Math.max(0, Math.round((bitmap.width - sourceWidth) / 2));
  const sourceY = Math.max(0, Math.round((bitmap.height - sourceHeight) / 2));

  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, uploadImageWidth, uploadImageHeight);
  bitmap.close();

  const blob = await canvasToWebpBlob(canvas);
  return new File([blob], imageOutputName(file), {
    type: "image/webp",
    lastModified: Date.now()
  });
}

export function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<ProductFormData>(emptyProduct);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvResults, setCsvResults] = useState<ApiResult[]>([]);
  const [imageResults, setImageResults] = useState<ApiResult[]>([]);
  const [selectedImageSku, setSelectedImageSku] = useState("");

  const csvSummary = useMemo(() => {
    const valid = csvRows.filter((row) => validatePreviewRow(row).length === 0).length;
    const needsTranslation = csvRows.filter((row) => {
      if (validatePreviewRow(row).length > 0) return false;
      const nameCn = String(row.name_cn || "").trim();
      const descCn = String(row.description_cn || "").trim();
      if (!nameCn && !descCn) return false;
      const nameEn = String(row.name_en || "").trim();
      const descEn = String(row.description_en || "").trim();
      const nameGr = String(row.name_gr || "").trim();
      const descGr = String(row.description_gr || "").trim();
      return !(nameEn && descEn && nameGr && descGr);
    }).length;
    return { valid, invalid: csvRows.length - valid, needsTranslation };
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

  async function readJsonResponse(response: Response, fallbackMessage: string) {
    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    throw new Error(text ? `${fallbackMessage}: ${text.slice(0, 160)}` : fallbackMessage);
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
      additional_image_urls: "",
      skroutz_url: product.skroutz_url
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function translateProduct() {
    if (!form.name_cn.trim() && !form.description_cn.trim()) {
      setStatus("请先填写中文名称或中文描述。");
      return;
    }

    if (
      (form.name_gr || form.description_gr || form.name_en || form.description_en) &&
      !window.confirm("当前已有希腊语或英语内容，是否用自动翻译结果覆盖？")
    ) {
      return;
    }

    setTranslating(true);
    setStatus("");

    try {
      const data = (await api("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({
          name_cn: form.name_cn,
          description_cn: form.description_cn
        })
      })) as TranslationResult;

      setForm((current) => ({
        ...current,
        name_gr: data.name_gr,
        description_gr: data.description_gr,
        name_en: data.name_en,
        description_en: data.description_en
      }));
      setStatus("翻译已生成，请检查后再保存商品。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "自动翻译失败");
    } finally {
      setTranslating(false);
    }
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
      let statusMsg = `CSV 导入完成：成功 ${data.successCount}，失败 ${data.failureCount}`;
      if (data.translatedCount > 0) {
        statusMsg += `，翻译成功 ${data.translatedCount}`;
      }
      if (data.translateFailureCount > 0) {
        statusMsg += `，翻译失败 ${data.translateFailureCount}`;
      }
      setStatus(statusMsg);
      await loadProducts();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "CSV 导入失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadImages(files: FileList | null, options: ImageUploadOptions = {}) {
    setImageResults([]);
    if (!files || files.length === 0) {
      return;
    }

    if (options.sku && !options.mode) {
      setStatus("请选择上传类型。");
      return;
    }

    try {
      setLoading(true);
      setStatus("正在压缩图片...");

      const body = new FormData();
      const optimizedFiles = await Promise.all(Array.from(files).map((file) => compressImageForUpload(file)));
      optimizedFiles.forEach((file) => body.append("images", file));
      if (options.sku) {
        body.append("sku", options.sku);
      }
      if (options.mode) {
        body.append("mode", options.mode);
      }

      setStatus("正在上传图片...");

      const response = await fetch("/api/admin/images", {
        method: "POST",
        headers: {
          "x-admin-password": activePassword
        },
        body
      });
      const data = await readJsonResponse(response, "图片上传接口返回了服务器错误，请检查 Vercel Function 日志");

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

  async function deleteImage(options: ImageDeleteOptions) {
    const label = options.kind === "main" ? "主图" : "这张多图";

    if (!window.confirm(`确定删除${label}吗？Storage 文件也会一起删除。`)) {
      return;
    }

    try {
      setLoading(true);
      setStatus("");

      const response = await fetch("/api/admin/images", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": activePassword
        },
        body: JSON.stringify(options)
      });
      const data = await readJsonResponse(response, "删除图片接口返回了服务器错误，请检查 Vercel Function 日志");

      if (!response.ok) {
        throw new Error(data.error || "删除图片失败");
      }

      setStatus(`${label}已删除。`);
      await loadProducts();

      if (editingId && form.sku === options.sku) {
        setForm((current) => {
          if (options.kind === "main") {
            return { ...current, image_url: "" };
          }

          const nextUrls = imageLines(current.image_urls).filter((_, index) => index !== options.index);
          return { ...current, image_urls: nextUrls.join("\n") };
        });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除图片失败");
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-ink">{editingId ? "编辑商品" : "新增商品"}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-bold"
                disabled={translating}
                onClick={() => void translateProduct()}
                type="button"
              >
                {translating ? "翻译中..." : "自动翻译"}
              </button>
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
              <input
                className="input"
                placeholder="S,M,L,XL"
                value={form.sizes}
                onChange={(event) => updateField("sizes", event.target.value)}
              />
            </Field>
            <Field label="主图 URL">
              <input className="input" value={form.image_url} onChange={(event) => updateField("image_url", event.target.value)} />
            </Field>
            <Field label="Skroutz URL">
              <input
                className="input"
                placeholder="https://www.skroutz.gr/..."
                value={form.skroutz_url}
                onChange={(event) => updateField("skroutz_url", event.target.value)}
              />
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

          <div className="mt-4">
            <Field label="多图 URL（一行一个）">
              <textarea
                className="input min-h-28"
                value={form.image_urls}
                onChange={(event) => updateField("image_urls", event.target.value)}
                placeholder="https://example.com/front.webp&#10;https://example.com/back.webp&#10;https://example.com/detail.webp"
              />
            </Field>
          </div>

          {editingId ? (
            <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-4">
              <div>
                <h3 className="text-sm font-black text-ink">当前图片</h3>
                <p className="mt-1 text-xs text-stone-600">
                  删除后会同步清理 Supabase Storage；外部 URL 只会从商品中移除。
                </p>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                <div>
                  <p className="mb-2 text-xs font-bold text-stone-600">主图</p>
                  {form.image_url ? (
                    <ImagePreviewCard
                      disabled={loading}
                      imageUrl={form.image_url}
                      label="主图"
                      onDelete={() => void deleteImage({ sku: form.sku, kind: "main" })}
                    />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-xs text-stone-400">
                      无主图
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-xs font-bold text-stone-600">多图</p>
                  {imageLines(form.image_urls).length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {imageLines(form.image_urls).map((imageUrl, index) => (
                        <ImagePreviewCard
                          disabled={loading}
                          imageUrl={imageUrl}
                          key={`${imageUrl}-${index}`}
                          label={`多图 ${index + 1}`}
                          onDelete={() => void deleteImage({ sku: form.sku, kind: "gallery", index })}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-xs text-stone-400">
                      无多图
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

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
          <p className="mt-3 text-sm text-stone-600">字段：{csvFields.join(", ")}</p>
          {csvRows.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-bold text-ink">
                预览：有效 {csvSummary.valid}，错误 {csvSummary.invalid}
                {csvSummary.needsTranslation > 0 ? `，需翻译 ${csvSummary.needsTranslation}` : ""}
              </p>
              <ResultTable
                results={csvRows.map((row) => {
                  const errors = validatePreviewRow(row);
                  let message = errors.length === 0 ? "OK" : errors.join("; ");
                  if (errors.length === 0) {
                    const nameCn = String(row.name_cn || "").trim();
                    const descCn = String(row.description_cn || "").trim();
                    if (nameCn || descCn) {
                      const nameEn = String(row.name_en || "").trim();
                      const descEn = String(row.description_en || "").trim();
                      const nameGr = String(row.name_gr || "").trim();
                      const descGr = String(row.description_gr || "").trim();
                      if (nameEn && descEn && nameGr && descGr) {
                        message = "OK，无需翻译";
                      } else {
                        message = "OK，需翻译";
                      }
                    }
                  }
                  return {
                    rowNumber: Number(row.rowNumber),
                    sku: String(row.sku || ""),
                    ok: errors.length === 0,
                    message,
                  };
                })}
              />
            </div>
          ) : null}
          {csvResults.length > 0 ? <ResultTable results={csvResults} /> : null}
        </section>

        <section className="rounded-md border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-ink">批量上传商品图片</h2>
          <p className="mt-2 text-sm text-stone-600">上传后会自动压缩并保存为 WebP，再写回商品图片字段。</p>

          <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-4">
            <h3 className="text-sm font-black text-ink">选择商品上传（不用改文件名）</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <label className="block text-sm font-bold text-ink">
                商品
                <select
                  className="input mt-2"
                  value={selectedImageSku}
                  onChange={(event) => setSelectedImageSku(event.target.value)}
                >
                  <option value="">选择商品 SKU</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.sku}>
                      {product.sku} - {product.name_cn || product.name_gr || product.name_en || "未命名商品"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-bold text-ink">
                上传主图
                <input
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                  disabled={!selectedImageSku || loading}
                  onChange={(event) => {
                    void uploadImages(event.target.files, { sku: selectedImageSku, mode: "main" });
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>
              <label className="block text-sm font-bold text-ink">
                上传多图
                <input
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                  disabled={!selectedImageSku || loading}
                  multiple
                  onChange={(event) => {
                    void uploadImages(event.target.files, { sku: selectedImageSku, mode: "gallery" });
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-stone-200 bg-white p-4">
            <h3 className="text-sm font-black text-ink">按文件名批量上传（保留旧方式）</h3>
            <p className="mt-2 text-sm text-stone-600">
              主图文件名：SKU.jpg / SKU.png / SKU.webp；多图文件名：SKU-1.jpg、SKU-2.png。
            </p>
            <input
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="mt-3 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
              disabled={loading}
              multiple
              onChange={(event) => {
                void uploadImages(event.target.files);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </div>
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

function ImagePreviewCard({
  disabled,
  imageUrl,
  label,
  onDelete
}: {
  disabled: boolean;
  imageUrl: string;
  label: string;
  onDelete: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
      <img alt={label} className="aspect-[4/5] w-full bg-stone-100 object-cover" src={imageUrl} />
      <div className="grid gap-2 p-2">
        <p className="truncate text-xs font-bold text-stone-600" title={imageUrl}>
          {label}
        </p>
        <button
          className="rounded-md border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
          disabled={disabled}
          onClick={onDelete}
          type="button"
        >
          删除图片
        </button>
      </div>
    </div>
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
              <td className="py-2 pr-4">
                {result.message}
                {result.translateError ? (
                  <span className="ml-2 text-orange-600">翻译错误: {result.translateError}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
