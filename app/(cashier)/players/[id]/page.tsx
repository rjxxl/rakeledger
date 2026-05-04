import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updatePlayer } from "../../_actions/players";

export default async function EditPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">Edit {player.displayName}</h2>
      <form action={updatePlayer} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <input type="hidden" name="id" value={player.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Display name</span>
          <input name="displayName" required defaultValue={player.displayName} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Phone</span>
          <input name="phone" defaultValue={player.phone ?? ""} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Notes</span>
          <textarea name="notes" rows={3} defaultValue={player.notes ?? ""} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Save
        </button>
      </form>
    </div>
  );
}
