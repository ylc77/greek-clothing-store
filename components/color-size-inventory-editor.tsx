"use client";

import { useMemo, useState } from "react";
import {
  matrixColors,
  matrixSizes,
  matrixTotal,
  normalizeVariantColor,
  normalizeVariantSize,
  type ProductVariantMatrixRow,
  variantCatalogKey,
} from "@/lib/product-variant-matrix";

type ColorSizeInventoryEditorProps = {
  rows: ProductVariantMatrixRow[];
  onChange: (rows: ProductVariantMatrixRow[]) => void;
  availableSizes: string[];
  oneSize: boolean;
  showProcurement?: boolean;
  defaultColor?: string;
  onMessage?: (message: string, tone?: "ok" | "err") => void;
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function emptyRow(size: string, color: string): ProductVariantMatrixRow {
  return {
    size: normalizeVariantSize(size),
    color: normalizeVariantColor(color),
    quantity: 0,
    expectedOnHand: 0,
    quantityReserved: 0,
    supplierSku: "",
    costPrice: null,
    reorderLevel: null,
    active: true,
  };
}

export function ColorSizeInventoryEditor({
  rows,
  onChange,
  availableSizes,
  oneSize,
  showProcurement = false,
  defaultColor = "",
  onMessage,
}: ColorSizeInventoryEditorProps) {
  const [newColor, setNewColor] = useState("");
  const colors = useMemo(() => {
    const found = matrixColors(rows);
    return found.length > 0 ? found : [normalizeVariantColor(defaultColor)];
  }, [defaultColor, rows]);
  const namedColors = useMemo(() => colors.filter(Boolean), [colors]);
  const sizes = useMemo(() => matrixSizes(rows), [rows]);

  function report(message: string, tone: "ok" | "err" = "ok") {
    if (onMessage) onMessage(message, tone);
  }

  function setRow(nextRow: ProductVariantMatrixRow) {
    const key = variantCatalogKey(nextRow.size, nextRow.color);
    onChange(rows.map(row => variantCatalogKey(row.size, row.color) === key ? nextRow : row));
  }

  function addSize(rawSize: string) {
    const size = normalizeVariantSize(rawSize);
    const next = [...rows];
    let added = 0;
    for (const color of colors) {
      const key = variantCatalogKey(size, color);
      if (next.some(row => variantCatalogKey(row.size, row.color) === key)) continue;
      next.push(emptyRow(size, color));
      added += 1;
    }
    if (added === 0) {
      report("该尺码已在所有颜色中存在。", "err");
      return;
    }
    onChange(next);
  }

  function removeSize(size: string) {
    const targets = rows.filter(row => normalizeVariantSize(row.size) === normalizeVariantSize(size));
    if (targets.some(row => quantity(row.quantity) > 0 || quantity(row.expectedOnHand) > 0 || quantity(row.quantityReserved) > 0)) {
      report("该尺码仍有库存或历史库存快照，请先通过库存作业清零后再删除。", "err");
      return;
    }
    onChange(rows.filter(row => normalizeVariantSize(row.size) !== normalizeVariantSize(size)));
  }

  function addColor() {
    const color = normalizeVariantColor(newColor);
    if (!color) {
      report("请输入颜色名称。", "err");
      return;
    }
    if (colors.some(item => item.toLocaleLowerCase() === color.toLocaleLowerCase())) {
      report("该颜色已经存在。", "err");
      return;
    }
    const targetSizes = sizes.length > 0 ? sizes : (oneSize ? ["ONE SIZE"] : []);
    if (targetSizes.length === 0) {
      report("请先选择至少一个尺码，再新增颜色。", "err");
      return;
    }
    onChange([...rows, ...targetSizes.map(size => emptyRow(size, color))]);
    setNewColor("");
  }

  function renameColor(previousColor: string, nextValue: string) {
    const nextColor = normalizeVariantColor(nextValue);
    if (nextColor.toLocaleLowerCase() === normalizeVariantColor(previousColor).toLocaleLowerCase()) return true;
    if (colors.some(color => color.toLocaleLowerCase() === nextColor.toLocaleLowerCase())) {
      report("该颜色已经存在，不能产生重复的颜色与尺码规格。", "err");
      return false;
    }
    onChange(rows.map(row => normalizeVariantColor(row.color).toLocaleLowerCase() === normalizeVariantColor(previousColor).toLocaleLowerCase()
      ? { ...row, color: nextColor }
      : row));
    return true;
  }

  function removeColor(color: string) {
    const targets = rows.filter(row => normalizeVariantColor(row.color).toLocaleLowerCase() === normalizeVariantColor(color).toLocaleLowerCase());
    if (targets.some(row => quantity(row.quantity) > 0 || quantity(row.expectedOnHand) > 0 || quantity(row.quantityReserved) > 0)) {
      report("该颜色仍有库存或历史库存快照，请先通过库存作业清零后再删除。", "err");
      return;
    }
    if (colors.length <= 1) {
      report("商品至少需要保留一个默认颜色组。", "err");
      return;
    }
    onChange(rows.filter(row => normalizeVariantColor(row.color).toLocaleLowerCase() !== normalizeVariantColor(color).toLocaleLowerCase()));
  }

  function addCustomSize() {
    const raw = window.prompt("输入尺码名称，多个用逗号分隔", "");
    if (!raw) return;
    raw.split(/[/,，\s]+/).map(item => item.trim()).filter(Boolean).forEach(addSize);
  }

  return (
    <div className="space-y-4" data-color-size-inventory-editor>
      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-ink">1. 选择尺码</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableSizes.map(size => {
                const selected = sizes.includes(normalizeVariantSize(size));
                return (
                  <button
                    className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-black ${selected ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink hover:bg-stone-100"}`}
                    key={size}
                    onClick={() => selected ? removeSize(size) : addSize(size)}
                    type="button"
                  >
                    {size}
                  </button>
                );
              })}
              {!oneSize ? <button className="min-h-10 rounded-xl border border-dashed border-stone-300 px-3 py-2 text-xs font-black text-stone-500 hover:border-stone-400" onClick={addCustomSize} type="button">+ 自定义尺码</button> : null}
            </div>
          </div>
          <div className="w-full lg:w-[22rem]">
            <label className="text-sm font-black text-ink" htmlFor="variant-new-color">2. 同款其他颜色（选填）</label>
            <div className="mt-2 flex gap-2">
              <input
                className="input min-w-0 flex-1 bg-white"
                id="variant-new-color"
                onChange={event => setNewColor(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addColor(); } }}
                placeholder="例如 Yellow / Green"
                value={newColor}
              />
              <button className="min-h-11 shrink-0 rounded-xl border border-stone-300 bg-white px-4 text-sm font-black text-ink hover:bg-stone-100" onClick={addColor} type="button">添加</button>
            </div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-4 text-xs text-stone-500">请先选择尺码。只有一个颜色时可以把颜色名称留空，前台不会显示颜色选择器。</p>
      ) : (
        <div className="space-y-4">
          {colors.map(color => {
            const colorRows = rows
              .filter(row => normalizeVariantColor(row.color).toLocaleLowerCase() === normalizeVariantColor(color).toLocaleLowerCase())
              .sort((left, right) => sizes.indexOf(normalizeVariantSize(left.size)) - sizes.indexOf(normalizeVariantSize(right.size)));
            return (
              <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-900/5" key={color || "__default_color__"}>
                <div className="flex flex-col gap-3 border-b border-stone-100 bg-stone-50/70 p-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="min-w-0 flex-1 text-xs font-black text-stone-600">
                    颜色名称（单色商品可留空）
                    <input
                      className="input mt-1 bg-white"
                      defaultValue={color}
                      key={`color-input-${color}`}
                      onBlur={event => {
                        if (!renameColor(color, event.target.value)) event.currentTarget.value = color;
                      }}
                      placeholder="默认 / 主图颜色"
                    />
                  </label>
                  {colors.length > 1 ? <button className="min-h-10 rounded-xl border border-red-100 bg-white px-3 text-xs font-black text-red-500 hover:bg-red-50" onClick={() => removeColor(color)} type="button">删除该颜色</button> : null}
                </div>

                <div className="grid gap-2 p-3 sm:grid-cols-2 xl:hidden">
                  {colorRows.map(row => {
                    const key = variantCatalogKey(row.size, row.color);
                    return (
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3" key={key}>
                        <div className="flex items-center justify-between gap-3">
                          <div><p className="text-base font-black text-ink">{row.size}</p><p className={`mt-0.5 text-[10px] font-black ${quantity(row.quantity) > 0 ? "text-emerald-700" : "text-stone-400"}`}>{quantity(row.quantity) > 0 ? "有货" : "售罄"}</p></div>
                          {row.barcode ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">条码已就绪</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">保存时生成条码</span>}
                        </div>
                        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
                          <button className="min-h-11 rounded-xl border border-stone-300 bg-white text-lg font-black text-ink" onClick={() => setRow({ ...row, quantity: Math.max(0, quantity(row.quantity) - 1) })} type="button">−</button>
                          <input aria-label={`${color || "默认颜色"} ${row.size} 库存`} className="min-w-0 rounded-xl border border-stone-300 bg-white px-3 text-center text-lg font-black text-ink" inputMode="numeric" min="0" onChange={event => setRow({ ...row, quantity: quantity(event.target.value) })} step="1" type="number" value={quantity(row.quantity)} />
                          <button className="min-h-11 rounded-xl border border-stone-300 bg-white text-lg font-black text-ink" onClick={() => setRow({ ...row, quantity: quantity(row.quantity) + 1 })} type="button">+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto xl:block">
                  <table className={`w-full text-sm ${showProcurement ? "min-w-[820px]" : "min-w-[420px]"}`}>
                    <thead><tr className="bg-stone-50 text-stone-500"><th className="px-3 py-2 text-left text-xs font-bold">尺码</th><th className="px-3 py-2 text-left text-xs font-bold">库存</th>{showProcurement ? <><th className="px-3 py-2 text-left text-xs font-bold">供货商 SKU（选填）</th><th className="px-3 py-2 text-left text-xs font-bold">成本价 €（选填）</th><th className="px-3 py-2 text-left text-xs font-bold">补货线（选填）</th></> : null}<th className="px-3 py-2 text-left text-xs font-bold">Barcode</th></tr></thead>
                    <tbody>
                      {colorRows.map(row => {
                        const key = variantCatalogKey(row.size, row.color);
                        return (
                          <tr className="border-t border-stone-100" key={key}>
                            <td className="px-3 py-2 font-black text-ink">{row.size}</td>
                            <td className="px-3 py-2"><input aria-label={`${color || "默认颜色"} ${row.size} 库存`} className="w-24 rounded-lg border border-stone-200 px-2 py-1.5 text-center font-black" min="0" onChange={event => setRow({ ...row, quantity: quantity(event.target.value) })} step="1" type="number" value={quantity(row.quantity)} /></td>
                            {showProcurement ? <>
                              <td className="px-3 py-2"><input className="w-40 rounded-lg border border-stone-200 px-2 py-1.5 font-mono text-xs" onChange={event => setRow({ ...row, supplierSku: event.target.value })} value={row.supplierSku || ""} /></td>
                              <td className="px-3 py-2"><input className="w-28 rounded-lg border border-stone-200 px-2 py-1.5" min="0" onChange={event => setRow({ ...row, costPrice: event.target.value === "" ? null : Math.max(0, Number(event.target.value)) })} step="0.01" type="number" value={row.costPrice ?? ""} /></td>
                              <td className="px-3 py-2"><input className="w-24 rounded-lg border border-stone-200 px-2 py-1.5" min="0" onChange={event => setRow({ ...row, reorderLevel: event.target.value === "" ? null : quantity(event.target.value) })} step="1" type="number" value={row.reorderLevel ?? ""} /></td>
                            </> : null}
                            <td className="px-3 py-2 font-mono text-xs text-stone-500">{row.barcode || row.variantSku || "保存时自动生成"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-stone-500">{namedColors.length > 0 ? `已填写 ${namedColors.length} 个颜色` : "颜色未填写（使用主图款式）"}、{sizes.length} 个尺码、{rows.length} 个规格，总库存 {matrixTotal(rows)}。每个规格都会保存为独立 Variant，并拥有独立内部 Barcode。</p>
    </div>
  );
}
