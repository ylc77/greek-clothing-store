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
    setToasts((prev) => [...prev.slice(-5), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto animate-[fadeIn_0.2s_ease-out] rounded-lg px-4 py-3 text-sm font-bold text-white shadow-lg ${
              t.type === "err" ? "bg-red-600" : "bg-ink"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </ToastCtx.Provider>
  );
}
