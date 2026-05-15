"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { useDenominationMode } from "@/components/use-denomination-mode";
import {
  recordCashOut,
  getOpenMarkersForPlayer,
  type OpenMarkerDTO,
} from "../../_actions/transactions";
import { allocateMarkerRepayments } from "@/lib/payouts/marker-allocation";

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

type Scope = "ALL" | "TONIGHT" | "NONE";

function markerLabel(mk: OpenMarkerDTO): string {
  if (mk.isCurrentSession) return "Marker (tonight)";
  const d = new Date(mk.issuedAt);
  return `Marker (${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
}

function CashOutForm({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();
  const [denominationMode] = useDenominationMode();
  const [counts, setCounts] = useState<Record<string, number>>({ n100: 0, n25: 0, n5: 0, n1: 0 });
  const [singleAmount, setSingleAmount] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [scope, setScope] = useState<Scope>("ALL");
  const [markers, setMarkers] = useState<OpenMarkerDTO[]>([]);

  const denomTotal = DENOMS.reduce((sum, d) => sum + (counts[d.name] || 0) * d.unit, 0);
  const chipValueNum = denominationMode ? denomTotal : parseFloat(singleAmount) || 0;

  const { onSubmit, pending, error } = useFormAction(recordCashOut, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Cash-out $${fd.get("amount")} recorded for ${playerName}`);
      close();
    },
  });

  // Re-fetch markers only when the selected player changes.
  useEffect(() => {
    if (!playerId) {
      setMarkers([]);
      return;
    }
    let cancelled = false;
    getOpenMarkersForPlayer(playerId, sessionId).then((m) => {
      if (!cancelled) setMarkers(m);
    });
    return () => {
      cancelled = true;
    };
  }, [playerId, sessionId]);

  if (players.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          No players have been added yet. Cash-outs are recorded against a player.
        </p>
        <Link
          href="/players/new"
          onClick={close}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 text-center"
        >
          Add a player
        </Link>
      </div>
    );
  }

  const inScopeMarkers =
    scope === "NONE"
      ? []
      : scope === "TONIGHT"
        ? markers.filter((m) => m.isCurrentSession)
        : markers;

  const allocation = allocateMarkerRepayments(
    new Decimal(chipValueNum),
    inScopeMarkers.map((m) => ({ id: m.id, remaining: new Decimal(m.remaining) }))
  );
  const markerById = new Map(markers.map((m) => [m.id, m]));
  const repaidById = new Map(allocation.repayments.map((r) => [r.markerId, r.amount]));
  const stillOpenById = new Map(allocation.stillOpen.map((s) => [s.markerId, s.remaining]));
  const payoutStr = allocation.payout.toFixed(2);
  const hasDeduction = scope !== "NONE" && inScopeMarkers.length > 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="markerScope" value={scope} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select
          name="playerId"
          required
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
        >
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
          <input type="hidden" name="amount" value={denomTotal.toFixed(2)} />
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
            value={singleAmount}
            onChange={(e) => setSingleAmount(e.target.value)}
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Marker deduction</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
        >
          <option value="ALL">All open markers</option>
          <option value="TONIGHT">Tonight&apos;s markers only</option>
          <option value="NONE">None</option>
        </select>
      </label>

      <div className="bg-amber-500/10 border border-amber-500/40 rounded p-3 text-sm font-mono">
        <div className="flex justify-between">
          <span className="text-slate-300">Chips turned in</span>
          <span className="text-amber-300">${chipValueNum.toFixed(2)}</span>
        </div>
        {hasDeduction &&
          inScopeMarkers.map((m) => {
            const applied = repaidById.get(m.id);
            const leftover = stillOpenById.get(m.id);
            return (
              <div key={m.id} className="mt-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">─ {markerLabel(markerById.get(m.id) ?? m)}</span>
                  <span className="text-red-400">
                    −${(applied ?? new Decimal(0)).toFixed(2)}
                  </span>
                </div>
                {leftover && (
                  <div className="text-[10px] text-slate-500 pl-3">
                    ${leftover.toFixed(2)} still open
                  </div>
                )}
              </div>
            );
          })}
        <div className="border-t border-amber-500/30 mt-2 pt-2 flex justify-between">
          <span className="text-amber-400 uppercase tracking-wide text-xs">Payout to player</span>
          <span className="text-2xl font-semibold text-amber-300">${payoutStr}</span>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={pending || chipValueNum <= 0}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50"
      >
        {allocation.payout.greaterThan(0) ? `Pay out $${payoutStr}` : "Record (no payout)"}
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
