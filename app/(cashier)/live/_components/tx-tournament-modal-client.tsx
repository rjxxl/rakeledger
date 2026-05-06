"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordTournamentFee, recordTournamentPayout } from "../../_actions/transactions";

interface TournamentModalClientProps {
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

function TournamentForms({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();

  const fee = useFormAction(recordTournamentFee, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Tournament fee $${amount} recorded for ${playerName}`);
      close();
    },
  });

  const payout = useFormAction(recordTournamentPayout, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Tournament payout $${amount} to ${playerName}`);
      close();
    },
  });

  const playerOptions = (
    <>
      <option value="">— select —</option>
      {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
    </>
  );
  const methodOptions = (
    <>
      <option value="CASH">Cash</option>
      <option value="ZELLE">Zelle</option>
      <option value="VENMO">Venmo</option>
      <option value="CASHAPP">CashApp</option>
      <option value="APPLE_PAY">Apple Pay</option>
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <form onSubmit={fee.onSubmit} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Entry fee</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{playerOptions}</select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method</span>
          <select name="method" defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{methodOptions}</select>
        </label>
        {fee.error && <p className="text-red-400 text-xs">{fee.error}</p>}
        <button type="submit" disabled={fee.pending}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
          Record Entry
        </button>
      </form>

      <form onSubmit={payout.onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Payout</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Winner</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{playerOptions}</select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method</span>
          <select name="method" defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{methodOptions}</select>
        </label>
        {payout.error && <p className="text-red-400 text-xs">{payout.error}</p>}
        <button type="submit" disabled={payout.pending}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
          Record Payout
        </button>
      </form>
    </div>
  );
}

export function TournamentModalClient({ trigger, ...rest }: TournamentModalClientProps) {
  return (
    <Modal trigger={trigger} title="⇄ Tournament" description="Entry fees go in; payouts come out." wide>
      {(close) => <TournamentForms close={close} {...rest} />}
    </Modal>
  );
}
