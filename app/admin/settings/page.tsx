"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { BusinessSettings } from "@/lib/settings";
import {
  featureCatalog,
  featureGroups,
  featureKeys,
  featurePlanInfo,
  featurePlanPresets,
  toggleFeatureWithDependencies,
  type FeatureKey,
  type FeaturePlan,
} from "@/lib/feature-catalog";
import type { FeatureSettings } from "@/lib/features";

const emptyFeatureSettings: FeatureSettings = {
  id: 1,
  plan: "basic",
  features: { ...featurePlanPresets.basic },
  updated_by: null,
  created_at: null,
  updated_at: null,
  configured: false,
};

async function uploadStoreImage(file: File, name: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);

  const response = await fetch("/api/admin/settings/upload", {
    method: "POST",
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
  const [authorized, setAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [settings, setSettings] = useState<BusinessSettings>(emptySettings);
  const [featureSettings, setFeatureSettings] = useState<FeatureSettings>(emptyFeatureSettings);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [featureSaving, setFeatureSaving] = useState(false);

  async function api(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) setAuthorized(false);
      throw new Error(data.error || "请求失败");
    }
    return data;
  }

  async function checkDeveloperSession() {
    try {
      const response = await fetch("/api/admin/developer-session", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setAuthorized(response.ok && data.sessionValid === true);
      if (data.initialized === false) {
        setAuthError("开发者凭据尚未初始化，请由维护者在自己的电脑运行 bootstrap CLI。");
      } else if (data.mustRotate === true) {
        setAuthError("旧开发者凭据已停用，请由维护者通过 CLI 完成轮换。");
      }
    } finally {
      setAuthChecking(false);
    }
  }

  async function loginDeveloper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/developer-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败");
      setPassword("");
      setAuthorized(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  async function logoutDeveloper() {
    await fetch("/api/admin/developer-session", { method: "DELETE" }).catch(() => null);
    setAuthorized(false);
    setPassword("");
  }

  async function loadSettings() {
    setLoading(true);
    setStatus("");
    try {
      const [settingsData, featuresData] = await Promise.all([
        api("/api/admin/settings"),
        api("/api/admin/features"),
      ]);
      setSettings(settingsData);
      setFeatureSettings(featuresData.settings || emptyFeatureSettings);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取设置失败");
    } finally {
      setLoading(false);
    }
  }

  function selectFeaturePlan(plan: Exclude<FeaturePlan, "custom">) {
    setFeatureSettings((current) => ({ ...current, plan, features: { ...featurePlanPresets[plan] } }));
  }

  function toggleFeature(key: FeatureKey) {
    setFeatureSettings((current) => ({
      ...current,
      plan: "custom",
      features: toggleFeatureWithDependencies(current.features, key),
    }));
  }

  async function saveFeatureSettings() {
    setFeatureSaving(true);
    setStatus("");
    try {
      const data = await api("/api/admin/features", {
        method: "PUT",
        body: JSON.stringify({ plan: featureSettings.plan, features: featureSettings.features }),
      });
      setFeatureSettings(data.settings);
      setStatus("✓ 版本与功能设置已保存");
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "功能设置保存失败");
    } finally {
      setFeatureSaving(false);
    }
  }

  useEffect(() => { void checkDeveloperSession(); }, []);
  useEffect(() => { if (authorized) void loadSettings(); }, [authorized]);

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
      const url = await uploadStoreImage(file, type);
      updateField(type === "logo" ? "logo_url" : "hero_image_url", url);
      setStatus(type === "logo" ? "✓ Logo 已上传" : "✓ 首页大图已上传");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "上传失败");
    }
  }

  if (authChecking) {
    return <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#fbfaf6] via-white to-stone-100"><p className="text-sm font-black text-stone-500">正在检查开发者权限...</p></main>;
  }

  if (!authorized) {
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
            此页面仅供项目开发者维护，商家后台账号不能进入。
          </p>
          <form className="mt-6 space-y-4" onSubmit={loginDeveloper}>
            <input
              className="input text-center"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="开发者设置密码"
              type="password"
              value={password}
            />
            {authError ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{authError}</p> : null}
            <button className="w-full rounded-full bg-ink px-4 py-3 text-sm font-black text-white shadow-sm shadow-stone-900/10 hover:bg-stone-800 disabled:opacity-50" disabled={loading}>
              {loading ? "验证中..." : "开发者登录"}
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
            <a className="rounded-full border border-olive/30 bg-olive/10 px-4 py-2 text-xs font-black text-olive shadow-sm hover:bg-olive/15" href="/admin/legal-settings">
              法律与商家信息设置 · Legal Settings
            </a>
            <a className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50" href="/admin">
              返回商品后台
            </a>
            <button
              className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-ink shadow-sm hover:bg-stone-50"
              onClick={() => void logoutDeveloper()}
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

          <Section title="版本与功能" desc="按当前服装实体店工作流划分；客户版本控制模块，员工角色继续限制个人权限。">
            {!featureSettings.configured ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                当前使用兼容默认配置（全部开启）。保存前请先部署 feature_settings migration。
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-3">
              {(["basic", "standard", "advanced"] as const).map((plan) => (
                <button
                  className={`relative min-h-20 rounded-xl border px-3 py-3 text-left transition ${featureSettings.plan === plan ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink hover:bg-stone-50"}`}
                  key={plan}
                  onClick={() => selectFeaturePlan(plan)}
                  type="button"
                >
                  <span className="block text-sm font-black">{featurePlanInfo[plan].label}{plan === "standard" ? " · 推荐实体店" : ""}</span>
                  <span className={`mt-1 block text-[11px] leading-4 ${featureSettings.plan === plan ? "text-white/70" : "text-stone-500"}`}>{featurePlanInfo[plan].audience}</span>
                </button>
              ))}
            </div>
            <div className={`mt-3 rounded-xl border px-4 py-3 ${featureSettings.plan === "custom" ? "border-olive/30 bg-olive/5" : "border-stone-200 bg-stone-50"}`}>
              <p className="text-xs font-black text-ink">当前：{featureSettings.plan === "custom" ? "自定义组合" : featurePlanInfo[featureSettings.plan].label}</p>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {featureSettings.plan === "custom"
                  ? "手动开关功能后会自动标记为自定义；依赖模块会同步开启或关闭。"
                  : featurePlanInfo[featureSettings.plan].highlights.join(" · ")}
              </p>
            </div>
            <div className="mt-4 space-y-5">
              {featureGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2">
                    <p className="text-sm font-black text-ink">{group.label}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{group.desc}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {featureKeys.filter((key) => featureCatalog[key].group === group.key).map((key) => {
                      const enabled = featureSettings.features[key];
                      const locked = featureCatalog[key].alwaysOn === true;
                      return (
                        <button
                          aria-pressed={enabled}
                          className={`flex min-h-20 items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${enabled ? "border-emerald-200 bg-emerald-50/60" : "border-stone-200 bg-stone-50"} ${locked ? "cursor-default" : "hover:border-stone-300"}`}
                          disabled={locked}
                          key={key}
                          onClick={() => toggleFeature(key)}
                          type="button"
                        >
                          <span>
                            <span className="block text-sm font-black text-ink">{featureCatalog[key].label}</span>
                            <span className="mt-1 block text-xs leading-4 text-stone-500">{featureCatalog[key].desc}</span>
                            {locked ? <span className="mt-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200">所有版本固定开启</span> : null}
                          </span>
                          <span className={`flex h-6 w-10 shrink-0 items-center rounded-full p-1 transition ${enabled ? "justify-end bg-emerald-500" : "justify-start bg-stone-300"}`}>
                            <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-stone-500">
                关闭模块会隐藏前后台入口并让受保护 API 返回 403，不会删除历史商品、订单、库存流水或条码。POS 作废、小票和日报会跟随 POS 依赖关系自动调整。
              </p>
              <button className="admin-button-primary shrink-0" disabled={featureSaving} onClick={saveFeatureSettings} type="button">
                {featureSaving ? "保存中..." : "保存版本功能"}
              </button>
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
