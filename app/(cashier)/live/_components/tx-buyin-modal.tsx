"use client";

import { useState, useEffect, useTransition } from "react";
import { Modal } from "@/components/modal";
import { recordBuyIn } from "../../_actions/transactions";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
  trigger: React.ReactNode;
}

export function BuyInModal({ sessionId, gameId, players, tables, getUnredeemedPromo, trigger }: BuyInModalProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [unredeemed, setUnredeemed] = useState<string>("0");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedPlayerId) {
      setUnredeemed("0");
      return;
    }
    startTransition(async () => {
      const amount = await getUnredeemedPromo(selectedPlayerId);
      setUnredeemed(amount);
    });
  }, [selectedPlayerId, getUnredeemedPromo]);

  const showBanner = parseFloat(unredeemed) > 0;

  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      <form action={recordBuyIn} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select
            name="playerId"
            required
            value={selectedPlayerId}
            onChange={(e) => setSelectedPlayerId(e.target.value)}
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
          >
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>

        {showBanner && (
          <div className="bg-cyan-500/10 border border-cyan-700 text-cyan-300 text-xs rounded px-3 py-2">
            ⚡ This player has <strong>${unredeemed}</strong> in unredeemed freeroll chips.
            Only enter the <em>cash</em> they&apos;re handing you now — those promo chips are already on their stack.
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Table (optional)</span>
          <select name="tableId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— none —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input type="number" name="amount" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method</span>
          <select name="method" required defaultValue="CASH"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="CASH">Cash</option>
            <option value="ZELLE">Zelle</option>
            <option value="VENMO">Venmo</option>
            <option value="CASHAPP">CashApp</option>
            <option value="APPLE_PAY">Apple Pay</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <button type="submit" disabled={isPending}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
          Record Buy-in
        </button>
      </form>
    </Modal>
  );
}
