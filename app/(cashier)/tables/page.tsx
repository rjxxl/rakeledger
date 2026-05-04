import { prisma } from "@/lib/db";
import { createTable, toggleTableActive } from "../_actions/tables";

export default async function TablesPage() {
  const tables = await prisma.table.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Tables</h2>
      <form action={createTable} className="flex gap-2 mb-6 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
        <input name="name" required placeholder="Table name (e.g., Table 1)" className="flex-1 bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        <input name="stakes" placeholder="Stakes (e.g., 1/2 NL)" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 w-40" />
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Add</button>
      </form>
      {tables.length === 0 ? (
        <p className="text-slate-500">No tables yet.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {tables.map((t) => (
            <li key={t.id} className="flex justify-between items-center px-4 py-3">
              <div>
                <span className="font-medium">{t.name}</span>
                {t.stakes && <span className="text-slate-500 text-sm ml-2">{t.stakes}</span>}
                {!t.active && <span className="text-xs text-red-400 ml-2">inactive</span>}
              </div>
              <form action={toggleTableActive}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="text-xs text-slate-400 hover:text-white">
                  {t.active ? "deactivate" : "activate"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
