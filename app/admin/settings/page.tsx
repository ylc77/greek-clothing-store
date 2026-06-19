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
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadSettings() {
    setLoading(true);
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
    if (activePassword) {
      void loadSettings();
    }
  }, [activePassword]);

  function updateField(key: keyof BusinessSettings, value: string | boolean) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setStatus("设置已保存。前台页面可能需要刷新。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  if (!activePassword) {
    return (
      <main className="min-h-screen bg-paper px-4 py-10">
        <section className="mx-auto max-w-md rounded-md border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-ink">店铺设置</h1>
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setActivePassword(password);
            }}
          >
            <label className="block text-sm font-bold text-ink">
              管理密码
              <input
                className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2"
                onChange={(e) => setPassword(e.target.value)}
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

  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <label className="block text-sm font-bold text-ink">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );

  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <section className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4 border-b border-stone-200 pb-5">
          <h1 className="text-3xl font-bold text-ink">店铺设置</h1>
          <div className="flex gap-2">
            <a
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-ink"
              href="/admin"
            >
              返回商品管理
            </a>
            <button
              className="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-ink"
              onClick={() => {
                setActivePassword("");
                setPassword("");
              }}
              type="button"
            >
              退出
            </button>
          </div>
        </header>

        {status ? (
          <div className="mb-4 rounded-md border border-stone-200 bg-white p-4 text-sm text-ink">
            {status}
          </div>
        ) : null}

        <form
          className="rounded-md border border-stone-200 bg-white p-5 shadow-sm"
          onSubmit={saveSettings}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="店铺名称">
              <input
                className="input"
                value={settings.business_name}
                onChange={(e) => updateField("business_name", e.target.value)}
                placeholder="Helios Wear"
              />
            </Field>
            <Field label="Logo URL">
              <input
                className="input"
                value={settings.logo_url}
                onChange={(e) => updateField("logo_url", e.target.value)}
                placeholder="https://..."
              />
            </Field>
            <Field label="首页大图 URL">
              <input
                className="input"
                value={settings.hero_image_url}
                onChange={(e) => updateField("hero_image_url", e.target.value)}
                placeholder="https://..."
              />
            </Field>
            <Field label="电话">
              <input
                className="input"
                value={settings.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="+30 690 000 0000"
              />
            </Field>
            <Field label="WhatsApp">
              <input
                className="input"
                value={settings.whatsapp}
                onChange={(e) => updateField("whatsapp", e.target.value)}
                placeholder="https://wa.me/306900000000"
              />
            </Field>
            <Field label="Instagram">
              <input
                className="input"
                value={settings.instagram}
                onChange={(e) => updateField("instagram", e.target.value)}
                placeholder="https://instagram.com/..."
              />
            </Field>
            <Field label="Facebook">
              <input
                className="input"
                value={settings.facebook}
                onChange={(e) => updateField("facebook", e.target.value)}
                placeholder="https://facebook.com/..."
              />
            </Field>
            <Field label="TikTok">
              <input
                className="input"
                value={settings.tiktok}
                onChange={(e) => updateField("tiktok", e.target.value)}
                placeholder="https://tiktok.com/@..."
              />
            </Field>
            <Field label="地址">
              <input
                className="input"
                value={settings.address}
                onChange={(e) => updateField("address", e.target.value)}
                placeholder="Ermou 45, Athens 10563, Greece"
              />
            </Field>
            <Field label="Google Maps URL">
              <input
                className="input"
                value={settings.google_maps_url}
                onChange={(e) => updateField("google_maps_url", e.target.value)}
                placeholder="https://maps.google.com/?q=..."
              />
            </Field>
            <Field label="Skroutz">
              <select
                className="input"
                value={settings.enable_skroutz ? "true" : "false"}
                onChange={(e) =>
                  updateField("enable_skroutz", e.target.value === "true")
                }
              >
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </select>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="营业时间（每行一条）">
              <textarea
                className="input min-h-28"
                value={settings.opening_hours}
                onChange={(e) => updateField("opening_hours", e.target.value)}
                placeholder="Monday - Friday: 10:00 - 20:00"
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="简介 (中文)">
              <textarea
                className="input min-h-20"
                value={settings.description_cn}
                onChange={(e) => updateField("description_cn", e.target.value)}
              />
            </Field>
            <Field label="简介 (英文)">
              <textarea
                className="input min-h-20"
                value={settings.description_en}
                onChange={(e) => updateField("description_en", e.target.value)}
              />
            </Field>
            <Field label="简介 (希腊语)">
              <textarea
                className="input min-h-20"
                value={settings.description_gr}
                onChange={(e) => updateField("description_gr", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="页脚文字">
              <input
                className="input"
                value={settings.footer_text}
                onChange={(e) => updateField("footer_text", e.target.value)}
                placeholder="© 2026 Helios Wear. All rights reserved."
              />
            </Field>
          </div>

          <button
            className="mt-5 rounded-md bg-ink px-5 py-3 text-sm font-bold text-white"
            disabled={loading}
          >
            保存设置
          </button>
        </form>
      </section>
    </main>
  );
}
