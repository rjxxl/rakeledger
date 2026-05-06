"use client";

import { useDenominationMode } from "@/components/use-denomination-mode";

export function DenominationToggle() {
  const [enabled, setEnabled] = useDenominationMode();
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div>
        <div className="text-sm font-medium text-slate-200">Chip denomination grid for cash-outs</div>
        <div className="text-xs text-slate-500 mt-1">
          When enabled, the cash-out modal asks for chip counts by denomination
          ($100 / $25 / $5 / $1) and shows a live running total. When disabled, the modal asks
          for a single dollar amount. Default: off.
        </div>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="w-5 h-5 accent-amber-500 mt-0.5"
      />
    </label>
  );
}
