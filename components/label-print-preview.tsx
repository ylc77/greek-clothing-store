"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type LabelSize = "40x30" | "50x30" | "60x40";

export type PrintableVariantLabel = {
  product_name: string;
  product_sku: string;
  variant_id: string;
  variant_sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: number;
  quantity_on_hand: number;
  active: boolean;
};

const labelSizeClass: Record<LabelSize, string> = {
  "40x30": "w-[40mm] min-h-[30mm]",
  "50x30": "w-[50mm] min-h-[30mm]",
  "60x40": "w-[60mm] min-h-[40mm]",
};

function formatEuro(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

export function LabelPrintPreview({
  labels,
  labelSize,
  storeName = "clothing store",
  onClose,
}: {
  labels: PrintableVariantLabel[];
  labelSize: LabelSize;
  storeName?: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [barcodeError, setBarcodeError] = useState("");
  const labelSizeText = useMemo(() => labelSize.replace("x", " x "), [labelSize]);

  useEffect(() => {
    let cancelled = false;

    async function renderBarcodes() {
      setBarcodeError("");
      try {
        const mod = await import("jsbarcode");
        const JsBarcode = mod.default as unknown as (
          element: SVGSVGElement,
          value: string,
          options: Record<string, unknown>,
        ) => void;

        if (cancelled || !rootRef.current) return;
        rootRef.current.querySelectorAll<SVGSVGElement>("svg[data-barcode]").forEach((svg) => {
          const value = svg.dataset.barcode || "";
          if (!value) return;
          JsBarcode(svg, value, {
            format: "CODE128",
            displayValue: false,
            margin: 0,
            height: labelSize === "60x40" ? 34 : 26,
            width: 1.4,
          });
        });
      } catch (error) {
        if (!cancelled) {
          setBarcodeError(error instanceof Error ? error.message : "Barcode render failed.");
        }
      }
    }

    void renderBarcodes();
    return () => {
      cancelled = true;
    };
  }, [labels, labelSize]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-950/50 p-3 sm:items-center">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .label-print-root,
          .label-print-root * {
            visibility: visible !important;
          }
          .label-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .label-no-print {
            display: none !important;
          }
          .label-page {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          @page {
            margin: 2mm;
            size: auto;
          }
        }
      `}</style>

      <div className="max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-stone-200 bg-paper p-4 shadow-2xl shadow-stone-950/25 sm:p-5">
        <div className="label-no-print mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Label Preview</p>
            <h3 className="mt-1 text-xl font-black text-ink">商品标签预览</h3>
            <p className="mt-1 text-xs font-bold text-stone-500">
              单列浏览器打印，当前尺寸 {labelSizeText}mm，共 {labels.length} 张。
            </p>
            {barcodeError ? <p className="mt-2 text-xs font-bold text-red-700">条码渲染失败：{barcodeError}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="min-h-10 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-black text-ink hover:bg-stone-50"
              onClick={() => window.print()}
              type="button"
            >
              打印标签
            </button>
            <button
              className="min-h-10 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-black text-ink hover:bg-stone-50"
              onClick={onClose}
              type="button"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl bg-stone-100/70 p-4">
          <div ref={rootRef} className="label-print-root flex flex-col items-start gap-[2mm]">
            {labels.map((label) => {
              const barcode = label.barcode || label.variant_sku;
              return (
                <article
                  className={`label-page ${labelSizeClass[labelSize]} overflow-hidden bg-white px-[2.5mm] py-[2mm] font-sans text-[9px] leading-tight text-stone-950 shadow-sm`}
                  key={label.variant_id}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="truncate text-[8px] font-black uppercase tracking-wide">{storeName}</p>
                    <p className="shrink-0 text-[9px] font-black">{formatEuro(label.price)}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[18px] text-[10px] font-black">{label.product_name}</p>
                  <p className="truncate text-[8px] font-bold text-stone-500">{label.variant_sku}</p>
                  <div className="mt-1 flex justify-center">
                    <svg className="max-w-full" data-barcode={barcode} />
                  </div>
                  <p className="mt-0.5 truncate text-center font-mono text-[8px] font-bold">{barcode}</p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[8px] font-bold">
                    <span>{label.size ? `Size: ${label.size}` : "Size: -"}</span>
                    <span className="truncate text-right">{label.color ? `Color: ${label.color}` : ""}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <p className="label-no-print mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
          第一版使用浏览器打印。真实标签纸可能需要在打印机驱动里选择对应纸张尺寸，并关闭页眉页脚。
        </p>
      </div>
    </div>
  );
}
