"use client";

import { FormEvent, useEffect, useState } from "react";
import type { BusinessSettings } from "@/lib/settings";

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
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-bold text-ink">
      {label}
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1 text-[10px] text-stone-400">{hint}</p> : null}
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
      headers: { "Content-Type": "application/json", "x-admin-password": activePassword, ...(init.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadSettings() {
    setLoading(true);
    try { const data = await api("/api/admin/settings"); setSettings(data); } catch (error) { setStatus(error instanceof Error ? error.message : "读取设置失败"); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (activePassword) void loadSettings();
  }, [activePassword]);

  function updateField(key: keyof BusinessSettings, value: string | boolean) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setStatus("");
    try { await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }); setStatus("✓ 店铺设置已保存"); setTimeout(() => setStatus(""), 3000); } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败"); } finally { setLoading(false); }
  }

  if (!activePassword) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <section className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-xl font-black text-ink">店铺设置</h1>
          <p className="mt-2 text-xs text-stone-400">管理店铺名称、Logo、联系方式等</p>
          <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); setActivePassword(password); }}>
            <input className="input text-center" onChange={e => setPassword(e.target.value)} type="password" value={password} placeholder="管理密码" />
            <button className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-stone-800">登录</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto max-w-4xl">
        {/* ── Header ──────────────────────────────────── */}
        <header className="mb-6 flex items-center justify-between gap-4 border-b border-stone-100 pb-5">
          <div>
            <h1 className="text-2xl font-black text-ink">店铺设置</h1>
            <p className="text-xs text-stone-400">管理店铺名称、联系方式、地址、营业时间和简介</p>
          </div>
          <div className="flex gap-2">
            <a className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50 transition" href="/admin">返回商品管理</a>
            <button className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-ink hover:bg-stone-50 transition" onClick={() => { setActivePassword(""); setPassword(""); }} type="button">退出</button>
          </div>
        </header>

        {status ? (
          <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-bold ${status.startsWith("✓") ? "bg-green-50 text-green-800 border border-green-200" : "bg-white border border-stone-200 text-ink"}`}>{status}</div>
        ) : null}

        <form className="flex flex-col gap-5" onSubmit={saveSettings}>
          {/* ── ① 基础信息 ─────────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">基础信息</h2>
            <p className="mb-4 text-xs text-stone-400">店铺名称、Logo 和首页大图。</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="店铺名称" hint="显示在顶部导航、首页标题和页脚">
                <input className="input" value={settings.business_name} onChange={e => updateField("business_name", e.target.value)} placeholder="Athens Fashion Boutique" />
              </Field>
              <Field label="Logo URL">
                <input className="input" value={settings.logo_url} onChange={e => updateField("logo_url", e.target.value)} placeholder="https://..." />
                {settings.logo_url ? <img alt="Logo 预览" className="mt-2 h-10 rounded border border-stone-200 object-contain" src={settings.logo_url} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
              </Field>
              <Field label="首页大图 URL" hint="建议横向图片，用于首页 Hero 区域">
                <input className="input" value={settings.hero_image_url} onChange={e => updateField("hero_image_url", e.target.value)} placeholder="https://..." />
                {settings.hero_image_url ? <img alt="首页大图预览" className="mt-2 h-24 w-full rounded-lg border border-stone-200 object-cover" src={settings.hero_image_url} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
              </Field>
            </div>
          </section>

          {/* ── ② 联系方式 ─────────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">联系方式</h2>
            <p className="mb-4 text-xs text-stone-400">留空则不在前台显示对应入口。</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="电话"><input className="input" value={settings.phone} onChange={e => updateField("phone", e.target.value)} placeholder="+30 690 000 0000" /></Field>
              <Field label="WhatsApp"><input className="input" value={settings.whatsapp} onChange={e => updateField("whatsapp", e.target.value)} placeholder="https://wa.me/306900000000" /></Field>
              <Field label="Instagram"><input className="input" value={settings.instagram} onChange={e => updateField("instagram", e.target.value)} placeholder="https://instagram.com/your_store" /></Field>
              <Field label="Facebook"><input className="input" value={settings.facebook} onChange={e => updateField("facebook", e.target.value)} placeholder="https://facebook.com/..." /></Field>
              <Field label="TikTok"><input className="input" value={settings.tiktok} onChange={e => updateField("tiktok", e.target.value)} placeholder="https://tiktok.com/@..." /></Field>
            </div>
          </section>

          {/* ── ③ 地址与地图 ───────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">地址与地图</h2>
            <p className="mb-4 text-xs text-stone-400">实体店地址和 Google Maps 分享链接。</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="地址"><input className="input" value={settings.address} onChange={e => updateField("address", e.target.value)} placeholder="Ermou 45, Athens 10563, Greece" /></Field>
              <Field label="Google Maps URL"><input className="input" value={settings.google_maps_url} onChange={e => updateField("google_maps_url", e.target.value)} placeholder="粘贴 Google Maps 分享链接" /></Field>
            </div>
          </section>

          {/* ── ④ 平台与营业 ───────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">平台与营业信息</h2>
            <p className="mb-4 text-xs text-stone-400">Skroutz 跳转开关和营业时间。</p>
            <div className="grid gap-4">
              <Field label="Skroutz" hint="开启后前台商品详情页显示 Skroutz 跳转入口，/feed.xml 可用">
                <select className="input" value={settings.enable_skroutz ? "true" : "false"} onChange={e => updateField("enable_skroutz", e.target.value === "true")}>
                  <option value="true">开启</option><option value="false">关闭</option>
                </select>
              </Field>
              <Field label="营业时间（每行一条）">
                <textarea className="input min-h-28" value={settings.opening_hours} onChange={e => updateField("opening_hours", e.target.value)} placeholder={`Monday - Friday: 10:00 - 20:00\nSaturday: 10:00 - 18:00\nSunday: Closed`} />
              </Field>
            </div>
          </section>

          {/* ── ⑤ 店铺简介 ─────────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">店铺简介</h2>
            <p className="mb-4 text-xs text-stone-400">显示在首页 Hero、品牌介绍和联系页面。</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="简介（中文）"><textarea className="input min-h-28" value={settings.description_cn} onChange={e => updateField("description_cn", e.target.value)} /></Field>
              <Field label="Introduction（English）"><textarea className="input min-h-28" value={settings.description_en} onChange={e => updateField("description_en", e.target.value)} /></Field>
              <Field label="Περιγραφή（Ελληνικά）"><textarea className="input min-h-28" value={settings.description_gr} onChange={e => updateField("description_gr", e.target.value)} /></Field>
            </div>
          </section>

          {/* ── ⑥ 页脚 ─────────────────────────────── */}
          <section className="rounded-xl border border-stone-100 bg-white p-5 shadow-sm">
            <h2 className="text-base font-black text-ink">页脚设置</h2>
            <p className="mb-4 text-xs text-stone-400">显示在前台所有页面的底部。</p>
            <Field label="页脚文字">
              <input className="input" value={settings.footer_text} onChange={e => updateField("footer_text", e.target.value)} placeholder={`© ${new Date().getFullYear()} ${settings.business_name || "Fashion Boutique"}. All rights reserved.`} />
            </Field>
          </section>

          {/* ── Save ─────────────────────────────────── */}
          <div className="flex items-center gap-3 rounded-xl border border-stone-100 bg-white p-4 shadow-sm">
            <button className="rounded-lg bg-ink px-10 py-3 text-sm font-bold text-white hover:bg-stone-800 shadow-sm transition" disabled={loading} type="submit">保存设置</button>
            <a className="rounded-lg border border-stone-200 px-6 py-3 text-sm font-bold text-ink hover:bg-stone-50 transition" href="/admin">返回商品管理</a>
          </div>
        </form>
      </div>
    </main>
  );
}
