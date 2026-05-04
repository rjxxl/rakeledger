import { Modal } from "@/components/modal";
import { recordTournamentFee, recordTournamentPayout } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TournamentModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
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
    <Modal trigger={trigger} title="⇄ Tournament" description="Entry fees go in; payouts come out." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={recordTournamentFee} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
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
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Entry</button>
        </form>

        <form action={recordTournamentPayout} className="flex flex-col gap-3">
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
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Payout</button>
        </form>
      </div>
    </Modal>
  );
}
