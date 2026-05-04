import { recordRake } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface RakeFormProps {
  sessionId: string;
  gameId: string;
}

export async function RakeForm({ sessionId, gameId }: RakeFormProps) {
  const dealers = await prisma.user.findMany({
    where: { role: "DEALER", status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <form action={recordRake} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">+ Rake drop</h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Dealer (optional)</span>
        <select name="staffId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— none —</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
        <span className="text-slate-400">Rake amount (chips)</span>
        <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Rake</button>
    </form>
  );
}
