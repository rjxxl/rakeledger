"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { useDenominationMode } from "@/components/use-denomination-mode";
import { recordCashOut } from "../../_actions/transactions";

interface CashOutModalClientProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
}

const DENOMS = [
  { name: "n100", label: "$100", unit: 100 },
  { name: "n25", label: "$25", unit: 25 },
  { name: "n5", label: "$5", unit: 5 },
  { name: "n1", label: "$1", unit: 1 },
] as const;

function CashOutForm({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();
  const [denominationMode] = useDenominationMode();
  const [counts, setCounts] = useState<Record<string, number>>({ n100: 0, n25: 0, n5: 0, n1: 0 });

  const total = DENOMS.reduce((sum, d) => sum + (counts[d.name] || 0) * d.unit, 0);

  const { onSubmit, pending, error } = useFormAction(recordCashOut, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Cash-out $${fd.get("amount")} recorded for ${playerName}`);
      close();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>

      {denominationMode ? (
        <>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Chip count</div>
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => (
              <label key={d.name} className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">{d.label}</span>
                <input
                  type="number"
                  min="0"
                  value={counts[d.name]}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [d.name]: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center"
                />
              </label>
            ))}
          </div>
          <div className="bg-amber-500/10 border border-amber-500/40 rounded p-3 text-center">
            <div className="text-xs text-amber-400 uppercase tracking-wide">Total chip value</div>
            <div className="font-mono text-2xl font-semibold text-amber-300">${total.toFixed(2)}</div>
          </div>
          <input type="hidden" name="amount" value={total.toFixed(2)} />
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Total amount</span>
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0.01"
            required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Payout method</span>
        <select name="method" required defaultValue="CASH"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="CASH">Cash</option>
          <option value="ZELLE">Zelle</option>
          <option value="VENMO">Venmo</option>
          <option value="CASHAPP">CashApp</option>
          <option value="APPLE_PAY">Apple Pay</option>
        </select>
      </label>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={pending || (denominationMode && total <= 0)}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50"
      >
        Record Cash-out
      </button>
    </form>
  );
}

export function CashOutModalClient({ trigger, ...rest }: CashOutModalClientProps) {
  return (
    <Modal trigger={trigger} title="− Cash-out" description="Record chips returned to the cage." wide>
      {(close) => <CashOutForm close={close} {...rest} />}
    </Modal>
  );
}
