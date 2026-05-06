"use client";

import { createContext, useContext } from "react";

export type ToastKind = "success" | "error" | "info";

export interface ToastShape {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
