"use client";

import Decimal from "decimal.js";
import { useState, useTransition } from "react";
import { formatLocalDate } from "@/lib/format";
import { recordChipWalk, recordChipReturn } from "../../_actions/walks";

/** Serialized walk passed across the RSC boundary (Prisma Decimal → string, Date → string) */
interface Walk {
  id: string;
  player: { id: string; displayName: string } | null;
  amount: string;
  sessionOpenedAt: string;
}

interface CandidatePlayer {
  id: string;
  displayName: string;
  /** Net positive CHIP_FLOAT exposure for this player this session (stringified Decimal) */
  unresolvedAmount: string;
}

interface Props {
  sessionId: string;
  gameId: string;
  chipFloatBalance: string;
  candidatePlayers: CandidatePlayer[];
  candidateWalks: Walk[];
}

/**
 * Pro-rata distribute `total` across candidates by their unresolvedAmount, rounded to
 * 2 decimal places. The last candidate absorbs any rounding remainder so the splits
 * sum exactly to `total`.
 */
function proRataSplit(total: Decimal, candidates: CandidatePlayer[]): Map<string, Decimal> {
  const splits = new Map<string, Decimal>();
  if (candidates.length === 0 || total.lessThanOrEqualTo(0)) return splits;

  const totalUnresolved = candidates.reduce(
    (sum, p) => sum.add(new Decimal(p.unresolvedAmount)),
    new Decimal(0)
  );
  if (totalUnresolved.equals(0)) return splits;

  let allocated = new Decimal(0);
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    let amt: Decimal;
    if (i === candidates.length - 1) {
      amt = total.sub(allocated); // remainder absorbs rounding drift
    } else {
      amt = new Decimal(p.unresolvedAmount)
        .div(totalUnresolved)
        .mul(total)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      allocated = allocated.add(amt);
    }
    splits.set(p.id, amt);
  }
  return splits;
}

export function WalksReturnsStep({ sessionId, gameId, chipFloatBalance: chipFloatBalanceStr, candidatePlayers, candidateWalks }: Props) {
  const chipFloatBalance = new Decimal(chipFloatBalanceStr);
  const [walkedIds, setWalkedIds] = useState<Set<string>>(new Set());
  const [bustedIds, setBustedIds] = useState<Set<string>>(new Set());
  const [autoPending, startAutoTransition] = useTransition();

  if (chipFloatBalance.equals(0)) {
    return <p className="text-sm text-green-500">✓ chip_float = $0 — nothing to reconcile.</p>;
  }

  if (chipFloatBalance.greaterThan(0)) {
    const visibleCandidates = candidatePlayers.filter((p) => !bustedIds.has(p.id) && !walkedIds.has(p.id));
    const bustedNames = [...bustedIds]
      .map((id) => candidatePlayers.find((p) => p.id === id)?.displayName)
      .filter((n): n is string => Boolean(n));

    const handleAutoAttribute = () => {
      const splits = proRataSplit(chipFloatBalance, visibleCandidates);
      if (splits.size === 0) return;

      startAutoTransition(async () => {
        for (const [playerId, amount] of splits) {
          if (amount.lessThanOrEqualTo(0)) continue;
          const fd = new FormData();
          fd.set("sessionId", sessionId);
          fd.set("gameId", gameId);
          fd.set("playerId", playerId);
          fd.set("amount", amount.toString());
          fd.set("note", "Auto-attributed at close");
          await recordChipWalk(fd);
          setWalkedIds((s) => new Set(s).add(playerId));
        }
      });
    };

    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm mb-3">
          <span className="text-amber-500 font-semibold">${chipFloatBalance.toString()} in chips unaccounted for.</span>
          {" "}Mark each player who walked with chips, or X out players who busted (chips redistributed via play).
          The auto-attribute button at the bottom splits the remaining variance pro-rata across un-marked players.
        </p>
        <ul className="flex flex-col gap-2">
          {visibleCandidates.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {p.displayName}
                <span className="text-xs text-slate-500 ml-2">${p.unresolvedAmount} in chips</span>
              </span>
              <form action={async (fd) => {
                await recordChipWalk(fd);
                setWalkedIds((s) => new Set(s).add(p.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={p.id} />
                <input name="amount" type="number" step="0.01" min="0.01"
                  defaultValue={p.unresolvedAmount}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-24 font-mono text-right text-sm" />
                <input name="note" placeholder="note (optional)"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-40 text-sm" />
                <button type="submit"
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs">
                  Mark walked
                </button>
              </form>
              <button
                type="button"
                onClick={() => setBustedIds((s) => new Set(s).add(p.id))}
                title="Player busted — chips redistributed via play, no walk recorded"
                className="border border-red-900 text-red-400 hover:bg-red-950/40 rounded px-2 py-1 text-xs"
              >
                ✗ Busted
              </button>
            </li>
          ))}
        </ul>

        {bustedNames.length > 0 && (
          <div className="text-xs text-slate-500 mt-3 flex items-center gap-2">
            <span className="line-through">Busted: {bustedNames.join(", ")}</span>
            <button
              type="button"
              onClick={() => setBustedIds(new Set())}
              className="text-amber-500 hover:underline"
            >
              undo
            </button>
          </div>
        )}

        {visibleCandidates.length > 0 && (
          <button
            type="button"
            onClick={handleAutoAttribute}
            disabled={autoPending}
            className="mt-4 bg-amber-500 text-black font-semibold rounded px-3 py-2 text-sm hover:bg-amber-400 disabled:opacity-50"
          >
            {autoPending
              ? "Attributing…"
              : `Auto-attribute remaining $${chipFloatBalance.toString()} pro-rata across ${visibleCandidates.length} player${visibleCandidates.length === 1 ? "" : "s"}`}
          </button>
        )}

        {visibleCandidates.length === 0 && bustedNames.length > 0 && (
          <p className="text-xs text-amber-400 mt-3">
            All remaining candidates marked busted. The remaining ${chipFloatBalance.toString()} variance will be
            recorded against the chip_float account at close-out (Step 6) — accept it as a count variance.
          </p>
        )}
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
                {w.player?.displayName ?? "Unknown"} — ${w.amount}
                <span className="text-xs text-slate-500 ml-2">
                  walked {formatLocalDate(w.sessionOpenedAt)}
                </span>
              </span>
              <form action={async (fd) => {
                await recordChipReturn(fd);
                setWalkedIds((s) => new Set(s).add(w.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={w.player?.id ?? ""} />
                <input type="hidden" name="amount" value={w.amount} />
                <input type="hidden" name="matchesWalkId" value={w.id} />
                <button type="submit" disabled={walkedIds.has(w.id)}
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs disabled:opacity-30">
                  {walkedIds.has(w.id) ? "✓" : "Match return"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
