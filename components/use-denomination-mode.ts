"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "rakeledger.cashOutDenominationMode";

/**
 * Read/write the cashier's "use chip-denomination grid for cash-outs" preference.
 * Stored in localStorage; per-browser/per-device.
 *
 * SSR-safe: hook initializes to `false` on first render (server-side default), then
 * syncs to the actual stored value after mount via useEffect. Components using this
 * hook will briefly render the default-off layout before flipping to on, which is
 * acceptable for a setting that only affects an inline-rendered modal.
 */
export function useDenominationMode(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setEnabled(true);
  }, []);

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    }
  }, []);

  return [enabled, update];
}
