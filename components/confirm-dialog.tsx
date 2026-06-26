"use client";

import type { ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "success" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  prompt?: boolean;
  promptValue?: string;
  promptPlaceholder?: string;
  onPromptChange?: (value: string) => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
  prompt = false,
  promptValue = "",
  promptPlaceholder = "",
  onPromptChange,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmColors = {
    danger: "bg-red-600 hover:bg-red-700 text-white",
    success: "bg-green-600 hover:bg-green-700 text-white",
    default: "bg-ink hover:bg-stone-800 text-white",
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      {/* Dialog */}
      <div className="relative w-full max-w-[420px] rounded-xl bg-white shadow-2xl p-6 z-10 animate-[dialogIn_0.2s_ease-out]">
        <h3 className="text-base font-black text-ink">{title}</h3>
        <div className="mt-3 text-sm leading-6 text-stone-600">{description}</div>
        {prompt ? (
          <input
            className="mt-3 w-full rounded-lg border border-stone-200 px-3 py-2 text-base sm:text-sm"
            placeholder={promptPlaceholder}
            value={promptValue}
            onChange={e => onPromptChange?.(e.target.value)}
          />
        ) : null}
        <div className="mt-5 flex gap-3 justify-end">
          <button
            className="rounded-lg border border-stone-200 px-5 py-2.5 text-sm font-bold text-ink hover:bg-stone-50 disabled:opacity-50"
            disabled={loading}
            onClick={onCancel}
            type="button"
          >
            {cancelText}
          </button>
          <button
            className={`rounded-lg px-5 py-2.5 text-sm font-bold disabled:opacity-50 ${confirmColors[variant]}`}
            disabled={loading}
            onClick={onConfirm}
            type="button"
          >
            {loading ? "处理中..." : confirmText}
          </button>
        </div>
      </div>
      <style jsx global>{`
        @keyframes dialogIn {
          from { opacity: 0; transform: scale(0.95) translateY(-8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
