"use client";

import { useState } from "react";

type ReceiptOrder = {
  id?: string;
  order_number: string;
  status: string;
  payment_status?: string;
  source?: string;
  subtotal?: number;
  discount_total?: number;
  total: number;
  currency?: string;
  created_by?: string | null;
  notes?: string | null;
  created_at: string;
  completed_at?: string | null;
  voided_at?: string | null;
  refunded_at?: string | null;
};

type ReceiptItem = {
  id?: string;
  product_sku?: string;
  variant_sku?: string;
  barcode?: string | null;
  name?: string;
  size?: string | null;
  color?: string | null;
  quantity?: number;
  unit_price?: number;
  discount_total?: number;
  line_total?: number;
};

type ReceiptPayment = {
  id?: string;
  method?: string;
  amount?: number;
  currency?: string;
  status?: string;
  created_at?: string;
};

type StoreSettings = {
  store_name?: string | null;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsapp_url?: string | null;
};

export function PosReceiptPreview({
  order,
  items,
  payments,
  storeSettings,
  paperWidth = "80mm",
  onClose,
}: {
  order: ReceiptOrder;
  items: ReceiptItem[];
  payments: ReceiptPayment[];
  storeSettings?: StoreSettings | null;
  paperWidth?: "58mm" | "80mm";
  onClose: () => void;
}) {
  const [selectedPaperWidth, setSelectedPaperWidth] = useState<"58mm" | "80mm">(paperWidth);
  const isVoided = order.status === "voided";
  const currency = order.currency || payments[0]?.currency || "EUR";
  const subtotal = order.subtotal ?? items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const discount = order.discount_total ?? 0;
  const storeName = storeSettings?.store_name || storeSettings?.name || "clothing store";
  const contact = storeSettings?.whatsapp || storeSettings?.phone || "";
  const widthClass = selectedPaperWidth === "58mm" ? "w-[58mm]" : "w-[80mm]";

  function money(value: number | undefined) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0));
  }

  function dateTime(value: string | null | undefined) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-950/50 p-3 sm:items-center">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .pos-receipt-print-root,
          .pos-receipt-print-root * {
            visibility: visible !important;
          }
          .pos-receipt-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .pos-receipt-no-print {
            display: none !important;
          }
          @page {
            margin: 4mm;
            size: auto;
          }
        }
      `}</style>
      <div className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-stone-200 bg-paper p-4 shadow-2xl shadow-stone-950/25 sm:p-5">
        <div className="pos-receipt-no-print mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-400">Receipt Preview</p>
            <h3 className="mt-1 text-xl font-black text-ink">销售小票预览</h3>
            <p className="mt-1 text-xs font-bold text-stone-500">浏览器打印版本，不是正式税务发票。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-stone-300 bg-white p-1">
              {(["58mm", "80mm"] as const).map((width) => (
                <button
                  className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                    selectedPaperWidth === width ? "bg-ink text-white" : "text-stone-600 hover:bg-stone-50"
                  }`}
                  key={width}
                  onClick={() => setSelectedPaperWidth(width)}
                  type="button"
                >
                  {width}
                </button>
              ))}
            </div>
            <button
              className="min-h-10 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-black text-ink hover:bg-stone-50"
              onClick={() => window.print()}
              type="button"
            >
              打印小票
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

        <div className="flex justify-center overflow-x-auto rounded-2xl bg-stone-100/70 p-4">
          <article className={`pos-receipt-print-root ${widthClass} bg-white px-4 py-5 font-mono text-[11px] leading-relaxed text-stone-950 shadow-sm`}>
            {isVoided ? (
              <div className="mb-3 border-2 border-stone-950 px-2 py-1 text-center text-sm font-black">
                VOIDED / 已作废
              </div>
            ) : null}

            <header className="text-center">
              <h1 className="text-base font-black">{storeName}</h1>
              {storeSettings?.address ? <p className="mt-1 break-words text-[10px]">{storeSettings.address}</p> : null}
              {contact ? <p className="mt-1 break-words text-[10px]">{contact}</p> : null}
              <p className="mt-3 text-sm font-black">Order Receipt / 销售小票</p>
              <p className="mt-1 text-[10px] font-bold">This receipt is not a tax invoice.</p>
              <p className="text-[10px] font-bold">该小票不是正式税务发票。</p>
            </header>

            <div className="my-3 border-t border-dashed border-stone-500" />

            <section className="space-y-1">
              <div className="flex justify-between gap-3">
                <span>Order</span>
                <span className="text-right font-bold">{order.order_number}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Date</span>
                <span className="text-right">{dateTime(order.created_at)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Cashier</span>
                <span className="text-right">{order.created_by || "admin"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Payment</span>
                <span className="text-right">{payments[0]?.method || "-"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Status</span>
                <span className="text-right">{order.status}</span>
              </div>
            </section>

            <div className="my-3 border-t border-dashed border-stone-500" />

            <section className="space-y-3">
              {items.map((item, index) => (
                <div key={item.id || `${item.variant_sku}-${index}`}>
                  <p className="font-black">{item.name || item.variant_sku || "Item"}</p>
                  <p className="break-words text-[10px] text-stone-600">
                    {item.variant_sku || item.product_sku || "-"}
                    {item.size ? ` / ${item.size}` : ""}
                    {item.color ? ` / ${item.color}` : ""}
                  </p>
                  <div className="mt-1 flex justify-between gap-3">
                    <span>
                      {Number(item.quantity || 0)} x {money(Number(item.unit_price || 0))}
                    </span>
                    <span className="font-black">{money(Number(item.line_total || 0))}</span>
                  </div>
                </div>
              ))}
            </section>

            <div className="my-3 border-t border-dashed border-stone-500" />

            <section className="space-y-1">
              <div className="flex justify-between gap-3">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Discount</span>
                <span>{money(discount)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-stone-300 pt-2 text-sm font-black">
                <span>Total</span>
                <span>{money(Number(order.total || 0))}</span>
              </div>
            </section>

            {order.notes ? (
              <>
                <div className="my-3 border-t border-dashed border-stone-500" />
                <p className="break-words text-[10px]">Notes: {order.notes}</p>
              </>
            ) : null}

            <div className="my-3 border-t border-dashed border-stone-500" />

            <footer className="text-center text-[10px] font-bold">
              <p>Thank you / Ευχαριστούμε</p>
              <p className="mt-2">For returns or help, please contact the store.</p>
            </footer>
          </article>
        </div>

        <p className="pos-receipt-no-print mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
          手机也可以查看小票，但正式打印建议使用电脑或平板连接 58mm / 80mm 热敏打印机。
        </p>
      </div>
    </div>
  );
}
