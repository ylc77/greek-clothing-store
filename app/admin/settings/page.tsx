"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { BusinessSettings } from "@/lib/settings";

async function uploadStoreImage(file: File, name: string, password: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);

  const response = await fetch("/api/admin/settings/upload", {
    method: "POST",
    headers: { "x-admin-password": password },
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "上传失败");
  return data.url || "";
}

const emptySettings: BusinessSettings = {
  id: "",
  business_name: "",
  logo_url: "",
  hero_image_url: "",
  description_cn: "",
  description_en: "",
  description_gr: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  address: "",
  google_maps_url: "",
  opening_hours: "",
  footer_text: "",
  enable_skroutz: false,
  feed_min_stock: 1,
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-bold text-ink">
      {label}
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1.5 text-xs font-medium leading-5 text-stone-400">{hint}</p> : null}
    </label>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel">
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="admin-section-title">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-stone-400">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function UploadButton({
  label,
  onUpload,
}: {
  label: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);

  return (
    <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-stone-200 bg-white px-4 text-xs font-black text-ink shadow-sm transition hover:border-stone-300 hover:bg-stone-50">
      {uploading ? "上传中..." : label}
      <input
        accept="image/*"
        className="hidden"
        type="file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setUploading(true);
          try {
            await onUpload(file);
          } finally {
            setUploading(false);
            event.currentTarget.value = "";
          }
        }}
      />
    </label>
  );
}

export default function AdminSettingsPage() {
  const [password, setPassword] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [settings, setSettings] = useState<BusinessSettings>(emptySettings);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function api(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": activePassword,
        ...(init.headers || {}),
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  async function loadSettings() {
    setLoading(true);
    setStatus("");
    try {
      const data = await api("/api/admin/settings");
      setSettings(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取设置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activePassword) void loadSettings();
  }, [activePassword]);

  function updateField(key: keyof BusinessSettings, value: string | boolean | number) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      setStatus("✓ 店铺设置已保存");
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadImage(file: File, type: "logo" | "hero") {
    try {
      const url = await uploadStoreImage(file, type, activePassword);
      updateField(type === "logo" ? "logo_url" : "hero_image_url", url);
      setStatus(type === "logo" ? "✓ Logo 已上传" : "✓ 首页大图已上传");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "上传失败");
    }
  }

  if (!activePassword) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#fbfaf6] via-white to-stone-100 px-4 py-10">
        <section className="w-full max-w-sm rounded-3xl border border-stone-200/80 bg-white p-8 text-center shadow-xl shadow-stone-900/10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-ink">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1z" />
            </svg>
          </div>
          <h1 className="mt-5 text-2xl font-black text-ink">店铺设置</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            管理店铺名称、Logo、首页大图、联系方式和 Skroutz 设置。
          </p>
          <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); setActivePassword(password); }}>
            <input
              className="input text-center"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="管理密码"
              type="password"
              value={password}
            />
            <button className="w-full rounded-full bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800">
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  const statusOk = status.startsWith("✓");

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#fbfaf6] via-white to-[#f6f1ea] px-3 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-stone-200/80 bg-white/95 p-4 shadow-sm shadow-stone-900/5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-olive">Store Settings</p>
            <h1 className="mt-1 text-2xl font-black text-ink">店铺设置</h1>
            <p className="mt-1 text-xs leading-5 text-stone-400">
              控制前台品牌信息、联系方式、首页视觉和 Skroutz Feed 规则。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50" href="/admin">
              返回商品后台
            </a>
            <button
              className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50"
              onClick={() => { setActivePassword(""); setPassword(""); }}
              type="button"
            >
              退出
            </button>
          </div>
        </header>

        {status ? (
          <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${statusOk ? "border-green-200 bg-green-50 text-green-800" : "border-stone-200 bg-white text-ink"}`}>
            {status}
          </div>
        ) : null}

        <form className="flex flex-col gap-5" onSubmit={saveSettings}>
          <Section title="基础信息" desc="这些内容会显示在前台导航、首页、联系页和 SEO 信息里。">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="店铺名称" hint="例如：Athens Fashion Boutique。会显示在顶部导航、首页标题和页脚。">
                <input
                  className="input"
                  onChange={(event) => updateField("business_name", event.target.value)}
                  placeholder="Athens Fashion Boutique"
                  value={settings.business_name}
                />
              </Field>

              <Field label="Logo URL" hint="建议使用透明背景 PNG/WebP。也可以点击上传。">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    onChange={(event) => updateField("logo_url", event.target.value)}
                    placeholder="https://..."
                    value={settings.logo_url}
                  />
                  <UploadButton label="上传" onUpload={(file) => uploadImage(file, "logo")} />
                </div>
                {settings.logo_url ? (
                  <img
                    alt="Logo 预览"
                    className="mt-3 h-12 max-w-48 rounded-xl border border-stone-200 bg-white object-contain p-2"
                    src={settings.logo_url}
                    onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <p className="mt-2 text-xs text-stone-400">暂无 Logo。</p>
                )}
              </Field>

              <Field label="首页大图 URL" hint="建议 1200x900 或 1600x1200，适合服装模特图、店铺氛围图。">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    onChange={(event) => updateField("hero_image_url", event.target.value)}
                    placeholder="https://..."
                    value={settings.hero_image_url}
                  />
                  <UploadButton label="上传" onUpload={(file) => uploadImage(file, "hero")} />
                </div>
                {settings.hero_image_url ? (
                  <img
                    alt="首页大图预览"
                    className="mt-3 aspect-[4/3] w-full rounded-2xl border border-stone-200 object-cover"
                    src={settings.hero_image_url}
                    onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <p className="mt-2 text-xs text-stone-400">暂无首页大图，前台会使用默认占位图。</p>
                )}
              </Field>
            </div>
          </Section>

          <Section title="联系方式" desc="留空的项目不会在前台显示。WhatsApp 和 Instagram 是顾客最常用入口。">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="电话">
                <input className="input" onChange={(event) => updateField("phone", event.target.value)} placeholder="+30 690 000 0000" value={settings.phone} />
              </Field>
              <Field label="WhatsApp 链接">
                <input className="input" onChange={(event) => updateField("whatsapp", event.target.value)} placeholder="https://wa.me/306900000000" value={settings.whatsapp} />
              </Field>
              <Field label="Instagram 链接">
                <input className="input" onChange={(event) => updateField("instagram", event.target.value)} placeholder="https://instagram.com/your_store" value={settings.instagram} />
              </Field>
              <Field label="Facebook 链接">
                <input className="input" onChange={(event) => updateField("facebook", event.target.value)} placeholder="https://facebook.com/..." value={settings.facebook} />
              </Field>
              <Field label="TikTok 链接">
                <input className="input" onChange={(event) => updateField("tiktok", event.target.value)} placeholder="https://tiktok.com/@..." value={settings.tiktok} />
              </Field>
            </div>
          </Section>

          <Section title="地址与营业时间" desc="用于联系页和 AI 客服回答到店、营业时间相关问题。">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="店铺地址">
                <input className="input" onChange={(event) => updateField("address", event.target.value)} placeholder="Ermou 45, Athens 10563, Greece" value={settings.address} />
              </Field>
              <Field label="Google Maps 链接">
                <input className="input" onChange={(event) => updateField("google_maps_url", event.target.value)} placeholder="粘贴 Google Maps 分享链接" value={settings.google_maps_url} />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="营业时间（一行一条）">
                <textarea
                  className="input min-h-32"
                  onChange={(event) => updateField("opening_hours", event.target.value)}
                  placeholder={`Monday - Friday: 10:00 - 20:00\nSaturday: 10:00 - 18:00\nSunday: Closed`}
                  value={settings.opening_hours}
                />
              </Field>
            </div>
          </Section>

          <Section title="店铺介绍" desc="前台按语言展示；商品内容仍然从商品表读取。">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="中文简介">
                <textarea className="input min-h-32" onChange={(event) => updateField("description_cn", event.target.value)} value={settings.description_cn} />
              </Field>
              <Field label="English introduction">
                <textarea className="input min-h-32" onChange={(event) => updateField("description_en", event.target.value)} value={settings.description_en} />
              </Field>
              <Field label="Ελληνική περιγραφή">
                <textarea className="input min-h-32" onChange={(event) => updateField("description_gr", event.target.value)} value={settings.description_gr} />
              </Field>
            </div>
          </Section>

          <Section title="Skroutz 与页脚" desc="控制商品详情页 Skroutz 按钮和 /feed.xml 的最低库存规则。">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Skroutz 入口" hint="开启后，商品详情页会显示 Skroutz 跳转入口；feed.xml 保持可访问。">
                <select
                  className="input"
                  onChange={(event) => updateField("enable_skroutz", event.target.value === "true")}
                  value={settings.enable_skroutz ? "true" : "false"}
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </Field>
              <Field label="进入 Feed 的最低库存" hint="小店库存少时建议设置为 1 或 2，避免无库存商品进入 Skroutz Feed。">
                <input
                  className="input"
                  min="1"
                  onChange={(event) => updateField("feed_min_stock", Math.max(1, Number(event.target.value) || 1))}
                  step="1"
                  type="number"
                  value={settings.feed_min_stock}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="页脚文字">
                  <input
                    className="input"
                    onChange={(event) => updateField("footer_text", event.target.value)}
                    placeholder={`© ${new Date().getFullYear()} ${settings.business_name || "Fashion Boutique"}. All rights reserved.`}
                    value={settings.footer_text}
                  />
                </Field>
              </div>
            </div>
          </Section>

          <div className="admin-sticky-actions">
            <p className="text-xs font-bold text-stone-400">
              修改后点击保存，前台会在短时间内更新。
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a className="admin-button-secondary" href="/admin">
                返回商品后台
              </a>
              <button
                className="admin-button-primary"
                disabled={loading}
                type="submit"
              >
                {loading ? "保存中..." : "保存设置"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
