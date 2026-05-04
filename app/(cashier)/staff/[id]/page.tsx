import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updateStaff } from "../../_actions/staff";

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.user.findUnique({ where: { id } });
  if (!s) notFound();
  const useDefault = s.tipTaxRate === null;
  const customPct = s.tipTaxRate ? (Number(s.tipTaxRate) * 100).toFixed(0) : "";
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">Edit {s.name}</h2>
      <form action={updateStaff} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <input type="hidden" name="id" value={s.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input name="name" defaultValue={s.name} required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Role</span>
          <select name="role" required defaultValue={s.role} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="DEALER">Dealer</option>
            <option value="WAITRESS">Waitress</option>
            <option value="RUNNER">Runner</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="useDefaultTax" defaultChecked={useDefault} />
          <span className="text-slate-400">Use system default tip tax rate</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Custom tip tax rate (%)</span>
          <input name="tipTaxRate" type="number" min="0" max="100" step="1" defaultValue={customPct} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Save
        </button>
      </form>
    </div>
  );
}
