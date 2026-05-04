import { Modal } from "@/components/modal";
import { recordBuyIn } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function BuyInModal({ sessionId, gameId, trigger }: BuyInModalProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      <form action={recordBuyIn} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
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
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
          Record Buy-in
        </button>
      </form>
    </Modal>
  );
}
