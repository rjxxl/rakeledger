import { recordCashOut } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface CashOutFormProps {
  sessionId: string;
  gameId: string;
}

export async function CashOutForm({ sessionId, gameId }: CashOutFormProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });

  return (
    <form action={recordCashOut} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">− Cash-out</h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>

      <div className="text-xs text-slate-500 uppercase tracking-wide">Chip count</div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { name: "n100", label: "$100" },
          { name: "n25", label: "$25" },
          { name: "n5", label: "$5" },
          { name: "n1", label: "$1" },
        ].map((d) => (
          <label key={d.name} className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">{d.label}</span>
            <input
              type="number"
              name={d.name}
              defaultValue="0"
              min="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center"
            />
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Payout method</span>
        <select name="method" required defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="CASH">Cash</option>
          <option value="ZELLE">Zelle</option>
          <option value="VENMO">Venmo</option>
          <option value="CASHAPP">CashApp</option>
          <option value="APPLE_PAY">Apple Pay</option>
        </select>
      </label>

      <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
        Record Cash-out
      </button>
    </form>
  );
}
