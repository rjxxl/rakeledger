"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { executeTipPayout } from "../../_actions/payouts";
import type { TipPayoutRow } from "@/lib/payouts/tip-payout";

interface Props {
  sessionId: string;
  gameId: string;
  rows: TipPayoutRow[];
}

interface RowState {
  roundedTax: Decimal;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
  done: boolean;
}

export function TipPayoutStep({ sessionId, gameId, rows }: Props) {
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const r of rows) {
      initial[r.staffId] = { roundedTax: r.roundedTax, method: "CASH", done: false };
    }
    return initial;
  });

  function nudgeTax(staffId: string, direction: 1 | -1) {
    setState((s) => {
      const cur = s[staffId];
      return { ...s, [staffId]: { ...cur, roundedTax: cur.roundedTax.add(direction) } };
    });
  }

  function setMethod(staffId: string, method: RowState["method"]) {
    setState((s) => ({ ...s, [staffId]: { ...s[staffId], method } }));
  }

  async function confirm(row: TipPayoutRow) {
    const cur = state[row.staffId];
    const netToStaff = row.total.sub(cur.roundedTax);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", gameId);
    fd.set("staffId", row.staffId);
    fd.set("totalTipPool", row.total.toString());
    fd.set("calculatedTax", row.calculatedTax.toString());
    fd.set("roundedTax", cur.roundedTax.toString());
    fd.set("netToStaff", netToStaff.toString());
    fd.set("method", cur.method);
    await executeTipPayout(fd);
    setState((s) => ({ ...s, [row.staffId]: { ...s[row.staffId], done: true } }));
  }

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No tips to pay out tonight.</p>;
  }

  return (
    <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm">
      <thead>
        <tr className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
          <th className="text-left px-3 py-2">Staff</th>
          <th className="text-right px-3 py-2">Tip pool</th>
          <th className="text-right px-3 py-2">Rate</th>
          <th className="text-right px-3 py-2">Calc&apos;d tax</th>
          <th className="text-right px-3 py-2">Tax (rounded)</th>
          <th className="text-right px-3 py-2">Net to staff</th>
          <th className="text-right px-3 py-2">Method</th>
          <th className="text-center px-3 py-2"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cur = state[r.staffId];
          const netToStaff = r.total.sub(cur.roundedTax);
          return (
            <tr key={r.staffId} className="border-t border-[var(--color-border)]">
              <td className="px-3 py-2">{r.staffName}</td>
              <td className="px-3 py-2 text-right font-mono">${r.total.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{r.taxRate.mul(100).toFixed(0)}%</td>
              <td className="px-3 py-2 text-right text-slate-500 font-mono text-xs">${r.calculatedTax.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <button onClick={() => nudgeTax(r.staffId, 1)} disabled={cur.done}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-amber-500 w-5 h-5 rounded text-xs disabled:opacity-30">&#9650;</button>
                  <span className={`font-mono ${cur.roundedTax.equals(r.roundedTax) ? "text-cyan-400" : "text-amber-500"}`}>${cur.roundedTax.toString()}</span>
                  <button onClick={() => nudgeTax(r.staffId, -1)} disabled={cur.done}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-amber-500 w-5 h-5 rounded text-xs disabled:opacity-30">&#9660;</button>
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-green-400">${netToStaff.toString()}</td>
              <td className="px-3 py-2 text-right">
                <select value={cur.method} onChange={(e) => setMethod(r.staffId, e.target.value as RowState["method"])}
                  disabled={cur.done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option value="CASH">cash</option>
                  <option value="ZELLE">zelle</option>
                  <option value="VENMO">venmo</option>
                  <option value="CASHAPP">cashapp</option>
                  <option value="APPLE_PAY">apple</option>
                </select>
              </td>
              <td className="px-3 py-2 text-center">
                {cur.done ? (
                  <span className="text-xs text-green-500">&#10003; done</span>
                ) : (
                  <button onClick={() => confirm(r)}
                    className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs">
                    Confirm
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
