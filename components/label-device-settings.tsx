"use client";
import type { PrintProfile } from "@/lib/print-profile";

export function LabelDeviceSettings({ profile, onChange, storageAvailable }: {
  profile: PrintProfile; onChange: (profile: PrintProfile) => void; storageAvailable: boolean;
}) {
  return <details className="label-no-print mb-4 rounded-xl border border-stone-200 bg-white p-3">
    <summary className="cursor-pointer font-bold">设备与打印设置</summary>
    <p className="my-2 text-xs text-stone-600">适用打印机：Powertech PT-1509。请先在 Windows 中连接打印机，再从浏览器开始打印。</p>
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label><input type="checkbox" checked={profile.showStoreName} onChange={e => onChange({ ...profile, showStoreName: e.target.checked })} /> 显示店名</label>
      <label><input type="checkbox" checked={profile.showPrice} onChange={e => onChange({ ...profile, showPrice: e.target.checked })} /> 显示售价</label>
      {(["offsetX", "offsetY"] as const).map(key => <label key={key}>{key === "offsetX" ? "水平偏移" : "垂直偏移"}（mm）
        <input className="input ml-2 w-20" aria-label={key === "offsetX" ? "水平偏移" : "垂直偏移"} type="number" min={-3} max={3} step={0.1} value={profile[key]} onChange={e => onChange({ ...profile, [key]: e.target.valueAsNumber })} />
      </label>)}
    </div>
    <p className="mt-2 text-xs text-stone-500">偏移仅微调内容（±3 mm），请先用校准页验证，不要代替驱动纸张设置。浓度、纸张方向在驱动中设置。{storageAvailable ? "这些非敏感偏好仅保存在本浏览器。" : "浏览器存储不可用，偏好仅在本次预览有效。"}</p>
  </details>;
}
