"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordJackpotPayout } from "../../_actions/transactions";

interface JackpotModalClientProps {
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

function JackpotForm({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(recordJackpotPayout, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Jackpot $${amount} paid to ${playerName}`);
      close();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Winner</span>
        <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Reason</span>
        <input name="reason" required placeholder="bad-beat / high-hand / promo"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount</span>
        <input name="amount" type="number" step="0.01" min="0.01" required
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Paid in</span>
        <select name="paidIn" defaultValue="CHIPS" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="CHIPS">Chips (player keeps playing)</option>
          <option value="CASH">Cash (player walks)</option>
        </select>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Jackpot
      </button>
    </form>
  );
}

export function JackpotModalClient({ trigger, ...rest }: JackpotModalClientProps) {
  return (
    <Modal trigger={trigger} title="🏆 Jackpot payout" description="Funded from this game's rake pool.">
      {(close) => <JackpotForm close={close} {...rest} />}
    </Modal>
  );
}
