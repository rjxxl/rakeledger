"use client";

// No server shell needed: this modal needs `useState` for the unredeemed-promo banner,
// so it's already a client component. The other 8 Quick Action modals split into
// `tx-xxx-modal.tsx` (server, fetches data) + `tx-xxx-modal-client.tsx` (client, form + hooks).

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordBuyIn } from "../../_actions/transactions";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
}

function BuyInForm({ close, sessionId, gameId, players, tables, getUnredeemedPromo }: FormProps) {
  const toast = useToast();
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [unredeemed, setUnredeemed] = useState<string>("0");
  const [, startPromoTransition] = useTransition();

  useEffect(() => {
    if (!selectedPlayerId) { setUnredeemed("0"); return; }
    startPromoTransition(async () => {
      const amount = await getUnredeemedPromo(selectedPlayerId);
      setUnredeemed(amount);
    });
  }, [selectedPlayerId, getUnredeemedPromo]);

  const { onSubmit, pending, error } = useFormAction(recordBuyIn, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Buy-in $${fd.get("amount")} recorded for ${playerName}`);
      close();
    },
  });

  if (players.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          No players have been added yet. Buy-ins are recorded against a player.
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

  const showBanner = parseFloat(unredeemed) > 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select name="playerId" required value={selectedPlayerId}
          onChange={(e) => setSelectedPlayerId(e.target.value)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>
      {showBanner && (
        <div className="bg-cyan-500/10 border border-cyan-700 text-cyan-300 text-xs rounded px-3 py-2">
          ⚡ This player won <strong>${unredeemed}</strong> in freeroll prizes this session.
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
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Buy-in
      </button>
    </form>
  );
}

export function BuyInModal({ trigger, ...rest }: BuyInModalProps) {
  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      {(close) => <BuyInForm close={close} {...rest} />}
    </Modal>
  );
}
