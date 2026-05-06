"use client";

import * as Toast from "@radix-ui/react-toast";
import { useCallback, useState, type ReactNode } from "react";
import { ToastContext, type ToastKind, type ToastShape } from "./use-toast";

let nextId = 1;

const KIND_CLASSES: Record<ToastKind, string> = {
  success: "border-emerald-700 bg-emerald-950/80 text-emerald-200",
  error: "border-red-700 bg-red-950/80 text-red-200",
  info: "border-slate-700 bg-slate-900/80 text-slate-200",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastShape[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      <Toast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            className={`border rounded-md px-4 py-3 shadow-lg text-sm font-medium ${KIND_CLASSES[t.kind]}`}
            onOpenChange={(open) => { if (!open) dismiss(t.id); }}
          >
            <Toast.Title>{t.message}</Toast.Title>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[360px] max-w-[90vw] outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
