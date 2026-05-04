import { recordTipDrop } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface TipDropFormProps {
  sessionId: string;
  gameId: string;
}

export async function TipDropForm({ sessionId, gameId }: TipDropFormProps) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });

  return (
    <form action={recordTipDrop} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">+ Tip drop</h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Recipient</span>
        <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase()})</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount (chips)</span>
        <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Tip Drop</button>
    </form>
  );
}
