"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { distributeRakeForGame } from "../../_actions/payouts";

interface Recipient {
  userId: string;
  userName: string;
  amount: Decimal;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
}

interface Props {
  sessionId: string;
  gameId: string;
  gameName: string;
  totalRake: Decimal;
  initialRecipients: Recipient[];
}

export function RakeDistributionStep({ sessionId, gameId, gameName, totalRake, initialRecipients }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [done, setDone] = useState(false);

  const allocated = recipients.reduce((sum, r) => sum.add(r.amount), new Decimal(0));
  const remaining = totalRake.sub(allocated);

  function setAmount(userId: string, value: string) {
    setRecipients((rs) => rs.map((r) => r.userId === userId ? { ...r, amount: new Decimal(value || "0") } : r));
  }

  function setMethod(userId: string, method: Recipient["method"]) {
    setRecipients((rs) => rs.map((r) => r.userId === userId ? { ...r, method } : r));
  }

  async function submit() {
    if (!remaining.equals(0)) {
      alert(`Remaining must be $0.00 before distributing. Currently $${remaining.toString()}.`);
      return;
    }
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", gameId);
    fd.set("recipients", JSON.stringify(recipients.map((r) => ({
      userId: r.userId, amount: r.amount.toString(), method: r.method,
    }))));
    await distributeRakeForGame(fd);
    setDone(true);
  }

  if (totalRake.lessThanOrEqualTo(0)) {
    return <p className="text-xs text-slate-500">{gameName}: no rake to distribute.</p>;
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <header className="flex justify-between items-baseline mb-3">
        <h3 className="font-semibold text-amber-500">{gameName} &mdash; distribute rake</h3>
        <div className="text-xs text-slate-500">
          Pool: <span className="font-mono text-slate-200">${totalRake.toString()}</span> &middot;
          Remaining: <span className={`font-mono ${remaining.equals(0) ? "text-green-400" : "text-amber-400"}`}>${remaining.toString()}</span>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr><th className="text-left">Recipient</th><th className="text-right">Amount</th><th className="text-right">Method</th></tr>
        </thead>
        <tbody>
          {recipients.map((r) => (
            <tr key={r.userId} className="border-t border-[var(--color-border)]">
              <td className="py-2">{r.userName}</td>
              <td className="py-2 text-right">
                <input type="number" step="0.01" value={r.amount.toString()}
                  onChange={(e) => setAmount(r.userId, e.target.value)}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-28 font-mono text-right text-sm disabled:opacity-50" />
              </td>
              <td className="py-2 text-right">
                <select value={r.method} onChange={(e) => setMethod(r.userId, e.target.value as Recipient["method"])}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option value="CASH">cash</option>
                  <option value="ZELLE">zelle</option>
                  <option value="VENMO">venmo</option>
                  <option value="CASHAPP">cashapp</option>
                  <option value="APPLE_PAY">apple</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-right mt-3">
        {done
          ? <span className="text-sm text-green-500">&#10003; distributed</span>
          : <button onClick={submit} disabled={!remaining.equals(0)}
              className="bg-amber-500 text-black font-semibold rounded px-4 py-2 text-sm disabled:opacity-50">Distribute</button>}
      </div>
    </div>
  );
}
