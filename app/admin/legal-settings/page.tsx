"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  createEmptyLegalSettings,
  legalProviderKeys,
  type LegalConfirmations,
  type LegalProviderKey,
  type LegalSettingsData,
  type LegalSettingsRecord,
} from "@/lib/legal-settings";

const providerLabels: Record<LegalProviderKey, string> = {
  supabase: "Supabase", vercel: "Vercel", stripe: "Stripe", viva: "Viva",
  cash: "现金", pos: "刷卡机 / POS", posthog: "PostHog", sentry: "Sentry",
  openai: "OpenAI", deepseek: "DeepSeek",
};

const emptyRecord: LegalSettingsRecord = {
  settings: createEmptyLegalSettings(), configured: false, complete: false,
  currentVersion: null, publishedAt: null, publishedBy: null, updatedAt: null,
};

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return <section className="admin-panel"><h2 className="admin-section-title">{title}</h2><p className="mt-1 text-xs leading-5 text-stone-400">{desc}</p><div className="mt-5">{children}</div></section>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className="block text-sm font-bold text-ink">{label}{required ? <span className="ml-1 text-red-600">*</span> : null}<div className="mt-2">{children}</div></label>;
}

export default function LegalSettingsPage() {
  const [password, setPassword] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [record, setRecord] = useState<LegalSettingsRecord>(emptyRecord);
  const [settings, setSettings] = useState<LegalSettingsData>(emptyRecord.settings);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [linkChecks, setLinkChecks] = useState<Record<string, boolean | null>>({});

  async function api(method: string, body?: unknown) {
    const response = await fetch("/api/admin/legal-settings", {
      method,
      headers: { "Content-Type": "application/json", "x-admin-password": activePassword },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      setErrors(Array.isArray(data.errors) ? data.errors : []);
      throw new Error(data.error || "请求失败");
    }
    return data;
  }

  async function load() {
    setBusy(true); setStatus(""); setErrors([]);
    try {
      const data = await api("GET");
      setRecord(data.record);
      setSettings(data.record.settings);
      void checkLinks();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取失败");
    } finally { setBusy(false); }
  }

  async function checkLinks() {
    const paths = ["/privacy-policy", "/terms-of-service", "/cookie-policy", "/contact", "/refund-policy", "/cancellation-policy"];
    const results = await Promise.all(paths.map(async (path) => {
      try { const response = await fetch(path, { method: "GET" }); return [path, response.ok] as const; }
      catch { return [path, false] as const; }
    }));
    setLinkChecks(Object.fromEntries(results));
  }

  useEffect(() => { if (activePassword) void load(); }, [activePassword]);

  function update<K extends keyof LegalSettingsData>(key: K, value: LegalSettingsData[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function toggleProvider(key: LegalProviderKey) {
    const enabled = settings.enabledProviders.includes(key);
    update("enabledProviders", enabled ? settings.enabledProviders.filter((item) => item !== key) : [...settings.enabledProviders, key]);
  }

  function confirm(key: keyof LegalConfirmations, checked: boolean) {
    update("confirmations", { ...settings.confirmations, [key]: checked });
  }

  async function saveDraft(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setStatus(""); setErrors([]);
    try {
      const data = await api("PUT", { settings });
      setRecord(data.record); setSettings(data.record.settings);
      setErrors(data.errors || []); setStatus("✓ 法律配置草稿已保存");
    } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true); setStatus(""); setErrors([]);
    try {
      const data = await api("POST", { settings });
      setRecord(data.record); setSettings(data.record.settings);
      setStatus(`✓ 法律配置已发布：${data.version}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "发布失败"); }
    finally { setBusy(false); }
  }

  if (!activePassword) {
    return <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#fbfaf6] via-white to-stone-100 px-4 py-10">
      <section className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-olive">Legal Settings</p>
        <h1 className="mt-3 text-2xl font-black text-ink">法律与商家信息设置</h1>
        <p className="mt-2 text-sm text-stone-500">需要后台设置权限才能读取或修改法律配置。</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); setActivePassword(password); }}>
          <input className="input text-center" onChange={(event) => setPassword(event.target.value)} placeholder="管理密码" type="password" value={password} />
          <button className="admin-button-primary w-full" type="submit">登录</button>
        </form>
      </section>
    </main>;
  }

  const input = (key: keyof LegalSettingsData, placeholder = "", type = "text") => <input className="input" onChange={(event) => update(key, event.target.value as never)} placeholder={placeholder} type={type} value={String(settings[key] || "")} />;
  const area = (key: keyof LegalSettingsData, placeholder = "") => <textarea className="input min-h-28" onChange={(event) => update(key, event.target.value as never)} placeholder={placeholder} value={String(settings[key] || "")} />;

  return <main className="min-h-screen bg-gradient-to-b from-[#fbfaf6] via-white to-[#f6f1ea] px-3 py-4 sm:px-6 sm:py-8">
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-olive">Legal Settings</p><h1 className="mt-1 text-2xl font-black text-ink">法律与商家信息设置</h1><p className="mt-1 text-xs text-stone-400">草稿不会影响前台；点击“发布法律配置”才生成正式版本。</p></div>
        <div className="flex flex-wrap gap-2"><a className="admin-button-secondary" href="/admin/settings">返回 Settings</a><a className="admin-button-secondary" href="/admin">返回后台</a></div>
      </header>

      {!record.complete ? <div data-testid="legal-incomplete-warning" className="mb-5 rounded-2xl border border-red-300 bg-red-50 px-5 py-4 text-sm font-black text-red-800">法律信息未完成，不建议正式商用上线。</div> : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="admin-panel"><p className="text-xs text-stone-400">当前正式版本</p><p className="mt-1 text-xl font-black text-ink">{record.currentVersion || "尚未发布"}</p></div>
        <div className="admin-panel"><p className="text-xs text-stone-400">最近发布时间</p><p className="mt-1 text-sm font-black text-ink">{record.publishedAt ? new Date(record.publishedAt).toLocaleString() : "—"}</p></div>
        <div className="admin-panel"><p className="text-xs text-stone-400">发布人</p><p className="mt-1 text-sm font-black text-ink">{record.publishedBy || "—"}</p></div>
      </div>

      {status ? <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-bold ${status.startsWith("✓") ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{status}</div> : null}
      {errors.length ? <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900"><p className="font-black">发布前请完成：</p><ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}

      <form className="flex flex-col gap-5" onSubmit={saveDraft}>
        <Section title="项目类型" desc="决定前台优先展示退款退货政策，还是餐馆取消政策。">
          <select className="input max-w-md" onChange={(event) => update("projectType", event.target.value as "retail" | "restaurant")} value={settings.projectType}><option value="retail">服装 / 零售</option><option value="restaurant">餐馆</option></select>
        </Section>

        <Section title="商家身份信息" desc="带 * 的字段是发布必填项。">
          <div className="grid gap-4 md:grid-cols-2"><Field label="商家展示名称" required>{input("businessName")}</Field><Field label="法律主体名称" required>{input("legalName")}</Field><Field label="营业地址" required>{input("businessAddress")}</Field><Field label="VAT / AFM 税号" required>{input("vatNumber")}</Field><Field label="GEMI 注册号">{input("gemiNumber")}</Field><Field label="所在国家">{input("country")}</Field><Field label="联系电话" required>{input("phone")}</Field><Field label="联系邮箱" required>{input("contactEmail", "name@example.com", "email")}</Field></div>
        </Section>

        <Section title="数据控制者信息" desc="用于隐私政策和数据主体请求说明。">
          <div className="grid gap-4 md:grid-cols-2"><Field label="数据控制者名称">{input("dataControllerName")}</Field><Field label="数据控制者地址">{input("dataControllerAddress")}</Field><Field label="隐私请求联系邮箱">{input("privacyRequestEmail", "privacy@example.com", "email")}</Field><Field label="更正或删除个人信息申请方式">{area("privacyRequestInstructions")}</Field></div>
        </Section>

        <Section title="第三方服务" desc="只有勾选启用的服务会显示在前台法律页面。">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{legalProviderKeys.map((key) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold" key={key}><input checked={settings.enabledProviders.includes(key)} onChange={() => toggleProvider(key)} type="checkbox" />{providerLabels[key]}</label>)}</div>
          <div className="mt-4"><Field label="其他服务商说明">{area("otherProviders", "每行一个服务商及用途；留空则前台不显示。")}</Field></div>
        </Section>

        <Section title="Cookie 设置" desc="非必要分析、监控或广告脚本必须等待用户同意。">
          <Field label="技术必需 Cookie / 存储说明">{area("essentialStorageDescription")}</Field>
          <div className="mt-4 grid gap-3 md:grid-cols-3">{([ ["analyticsEnabled", "分析 Cookie"], ["errorMonitoringEnabled", "错误监控"], ["advertisingEnabled", "广告或追踪"] ] as const).map(([key, label]) => <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-bold" key={key}><input checked={settings[key]} onChange={(event) => update(key, event.target.checked)} type="checkbox" />{label}已启用</label>)}</div>
          <div className="mt-4 max-w-md"><Field label="Cookie 最后更新时间">{input("cookieLastUpdated", "YYYY-MM-DD", "date")}</Field></div>
        </Section>

        <Section title="服装 / 零售项目专用条款" desc="零售项目页脚将优先显示配送、退货与退款政策。">
          <div className="grid gap-4 md:grid-cols-2"><Field label="配送政策">{area("shippingPolicy")}</Field><Field label="退货政策">{area("returnPolicy")}</Field><Field label="退款政策">{area("refundPolicy")}</Field><Field label="14 天撤回权说明">{area("withdrawalRight")}</Field><Field label="退货地址">{area("returnAddress")}</Field><Field label="退货运费责任">{area("returnShippingResponsibility")}</Field><Field label="不支持退换的商品说明">{area("nonReturnableItems", "例如卫生用品、定制商品或依法不适用撤回权的商品。")}</Field><Field label="付款相关条款">{area("paymentTerms")}</Field></div>
        </Section>

        <Section title="餐馆项目预留条款" desc="当前仓库没有预约或餐馆下单流程；仅保留可复用法律文案，不新增业务流程。">
          <div className="grid gap-4 md:grid-cols-2"><Field label="取消政策">{area("cancellationPolicy")}</Field><Field label="过敏原免责声明">{area("allergenDisclaimer")}</Field><Field label="小票不是正式税务发票说明">{area("receiptDisclaimer")}</Field></div>
        </Section>

        <Section title="页脚链接检查" desc="检查公开法律页面是否可以打开。当前项目没有联系表单提交，条款同意提示为不适用。">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries({"/privacy-policy":"Privacy Policy","/terms-of-service":"Terms of Service","/cookie-policy":"Cookie Policy","/contact":"Contact","/refund-policy":"Refund Policy","/cancellation-policy":"Cancellation Policy"}).map(([path,label]) => <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-4" key={path}><a className="text-sm font-bold text-ink underline" href={path} target="_blank">{label}</a><span className={`text-xs font-black ${linkChecks[path] ? "text-green-700" : linkChecks[path] === false ? "text-red-700" : "text-stone-400"}`}>{linkChecks[path] ? "可打开" : linkChecks[path] === false ? "失败" : "检查中"}</span></div>)}</div>
          <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm font-bold text-stone-600">表单旁同意条款提示：当前没有预约或联系提交表单；POS 为店员后台操作，不额外阻断收银流程。</div>
        </Section>

        <Section title="客户最终确认" desc="五项确认全部完成后才允许发布正式法律版本。">
          <div className="grid gap-3">{([
            ["businessIdentity", "已确认商家身份信息"], ["paymentCopy", "已确认付款相关文案"], ["fulfilmentCopy", "已确认配送 / 取消 / 退款相关文案"], ["providers", "已确认实际启用的第三方服务"], ["disclaimer", "已知晓这些页面是基础法律页面模板，不是完整定制法律审查，也不能替代律师、会计师或当地合规专业人士的正式意见"],
          ] as const).map(([key,label]) => <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm font-bold leading-6" key={key}><input checked={settings.confirmations[key]} className="mt-1" onChange={(event) => confirm(key, event.target.checked)} type="checkbox" />{label}</label>)}</div>
          <div className="mt-4 max-w-md"><Field label="法律页面最后更新时间" required>{input("legalLastUpdated", "YYYY-MM-DD", "date")}</Field></div>
        </Section>

        <div className="admin-sticky-actions"><p className="text-xs font-bold text-stone-400">保存草稿不会改变前台；发布会生成不可变版本快照。</p><div className="flex flex-col gap-2 sm:flex-row"><button className="admin-button-secondary" disabled={busy} type="submit">{busy ? "处理中..." : "保存草稿"}</button><button className="admin-button-primary" data-testid="publish-legal-settings" disabled={busy} onClick={publish} type="button">发布法律配置</button></div></div>
      </form>
    </div>
  </main>;
}
