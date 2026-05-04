"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { recordChipWalk, recordChipReturn } from "../../_actions/walks";

interface Walk {
  id: string;
  player: { id: string; displayName: string } | null;
  amount: { toString(): string };
  session: { openedAt: Date };
}

interface Player {
  id: string;
  displayName: string;
}

interface Props {
  sessionId: string;
  gameId: string;
  chipFloatBalance: Decimal;
  candidatePlayers: Player[];
  candidateWalks: Walk[];
}

export function WalksReturnsStep({ sessionId, gameId, chipFloatBalance, candidatePlayers, candidateWalks }: Props) {
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (chipFloatBalance.equals(0)) {
    return <p className="text-sm text-green-500">✓ chip_float = $0 — nothing to reconcile.</p>;
  }

  if (chipFloatBalance.greaterThan(0)) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm mb-3">
          <span className="text-amber-500 font-semibold">${chipFloatBalance.toString()} in chips unaccounted for.</span>
          {" "}Mark each player who walked with chips. Total walked must equal the variance.
        </p>
        <ul className="flex flex-col gap-2">
          {candidatePlayers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.displayName}</span>
              <form action={async (fd) => {
                await recordChipWalk(fd);
                setDoneIds((s) => new Set(s).add(p.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={p.id} />
                <input name="amount" type="number" step="0.01" min="0.01" placeholder="$0.00"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-24 font-mono text-right text-sm" />
                <input name="note" placeholder="note (optional)"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-40 text-sm" />
                <button type="submit" disabled={doneIds.has(p.id)}
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs disabled:opacity-30">
                  {doneIds.has(p.id) ? "✓" : "Mark walked"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // chipFloatBalance.lessThan(0) — chips appeared
  const surplus = chipFloatBalance.abs();
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <p className="text-sm mb-3">
        <span className="text-cyan-400 font-semibold">${surplus.toString()} extra chips counted in.</span>
        {" "}Likely a player brought back chips from a prior session. Match against an outstanding walk:
      </p>
      {candidateWalks.length === 0 ? (
        <p className="text-xs text-slate-500">No prior walks to match. Use chip_float_adjust in the Other modal.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidateWalks.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {w.player?.displayName ?? "Unknown"} — ${w.amount.toString()}
                <span className="text-xs text-slate-500 ml-2">
                  walked {new Date(w.session.openedAt).toLocaleDateString()}
                </span>
              </span>
              <form action={async (fd) => {
                await recordChipReturn(fd);
                setDoneIds((s) => new Set(s).add(w.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={w.player?.id ?? ""} />
                <input type="hidden" name="amount" value={w.amount.toString()} />
                <input type="hidden" name="matchesWalkId" value={w.id} />
                <button type="submit" disabled={doneIds.has(w.id)}
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs disabled:opacity-30">
                  {doneIds.has(w.id) ? "✓" : "Match return"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
