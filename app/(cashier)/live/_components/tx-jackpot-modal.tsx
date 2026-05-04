import { Modal } from "@/components/modal";
import { recordJackpotPayout } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function JackpotModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <Modal trigger={trigger} title="🏆 Jackpot payout" description="Funded from this game's rake pool.">
      <form action={recordJackpotPayout} className="flex flex-col gap-3">
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
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Jackpot</button>
      </form>
    </Modal>
  );
}
