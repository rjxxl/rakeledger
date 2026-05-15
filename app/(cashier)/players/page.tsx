import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";

export default async function PlayersPage() {
  const clubId = await getActiveClubId();
  const players = await prisma.player.findMany({
    where: { clubId },
    orderBy: { displayName: "asc" },
  });
  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Players</h2>
        <Link href="/players/new" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">
          + New Player
        </Link>
      </header>
      {players.length === 0 ? (
        <p className="text-slate-500">No players yet. Add one to get started.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {players.map((p) => (
            <li key={p.id}>
              <Link href={`/players/${p.id}`} className="block px-4 py-3 hover:bg-white/5">
                <div className="font-medium">{p.displayName}</div>
                {p.phone && <div className="text-xs text-slate-500">{p.phone}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
