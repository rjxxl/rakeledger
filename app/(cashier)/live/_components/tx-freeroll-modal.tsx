import { Modal } from "@/components/modal";
import { recordFreerollPrize } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function FreerollModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <Modal trigger={trigger} title="🎁 Freeroll prize" description="House-funded prize chips. No cash moves.">
      <form action={recordFreerollPrize} className="flex flex-col gap-3">
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
          <span className="text-slate-400">Prize amount (chips)</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Freeroll name (optional)</span>
          <input name="freerollName" placeholder="e.g. Saturday Night Special"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Award Prize</button>
      </form>
    </Modal>
  );
}
