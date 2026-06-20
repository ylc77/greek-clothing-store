"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; type: "ok" | "err" };

let nextId = 1;

const ToastCtx = createContext<{
  toast: (message: string, type?: "ok" | "err") => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: "ok" | "err" = "ok") => {
    const id = nextId++;
    const duration = type === "err" ? 5000 : 2800;
    setToasts((prev) => [...prev.slice(-5), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Toast container — fixed top-center */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-32px)] max-w-xl">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm font-bold shadow-xl animate-[toastIn_0.25s_ease-out] min-w-[320px] ${
              t.type === "err"
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-emerald-50 text-emerald-800 border border-emerald-200"
            }`}
          >
            <span className="shrink-0 text-lg">
              {t.type === "ok" ? "✓" : "✕"}
            </span>
            <span className="flex-1">{t.message}</span>
            <button
              className="shrink-0 text-base font-bold opacity-40 hover:opacity-80 transition"
              onClick={() => dismiss(t.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastCtx.Provider>
  );
}
