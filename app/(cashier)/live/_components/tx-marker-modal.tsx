import { Modal } from "@/components/modal";
import { issueMarker, repayMarker } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface MarkerModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MarkerModal({ sessionId, gameId, trigger }: MarkerModalProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const openMarkers = await prisma.marker.findMany({
    where: { status: "OPEN" },
    include: { player: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <Modal trigger={trigger} title="$ Marker" description="Issue a new marker, or repay an existing one." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={issueMarker} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Issue marker</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Player</span>
            <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
              <option value="">— select —</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Amount</span>
            <input name="amount" type="number" step="0.01" min="0.01" required
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Collateral note</span>
            <input name="collateral" placeholder="e.g. gold watch"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Issue</button>
        </form>

        <form action={repayMarker} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Repay marker</h3>
          {openMarkers.length === 0 ? (
            <p className="text-xs text-slate-500">No open markers to repay.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Open marker</span>
                <select name="markerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                  <option value="">— select —</option>
                  {openMarkers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.player.displayName} — ${m.amount.toString()}
                      {m.repaidAmount.toString() !== "0" && ` (paid $${m.repaidAmount.toString()})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Payment</span>
                <input name="amount" type="number" step="0.01" min="0.01" required
                  className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Method</span>
                <select name="method" defaultValue="CASH"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                  <option value="CASH">Cash</option>
                  <option value="ZELLE">Zelle</option>
                  <option value="VENMO">Venmo</option>
                  <option value="CASHAPP">CashApp</option>
                  <option value="APPLE_PAY">Apple Pay</option>
                </select>
              </label>
              <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Repayment</button>
            </>
          )}
        </form>
      </div>
    </Modal>
  );
}
