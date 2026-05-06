import Link from "next/link";
import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";
import { prisma } from "@/lib/db";
import { AccountStrip } from "./_components/account-strip";
import { TransactionStream } from "./_components/transaction-stream";
import { QuickActions } from "./_components/quick-actions";
import { GameSwitcher } from "./_components/game-switcher";
import { GameManager } from "./_components/game-manager";
import { DropTracker } from "./_components/drop-tracker";

interface PageProps {
  searchParams: Promise<{ game?: string }>;
}

export default async function LiveSessionPage({ searchParams }: PageProps) {
  const session = await getOpenSession();
  const sp = await searchParams;

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">No session open</h2>
        <p className="text-slate-400 text-sm mb-4">
          Open a session to begin recording transactions. Set an optional starting cash float (the small bills already
          in the drawer for change-making).
        </p>
        <form action={openSession} className="flex flex-col gap-3">
          <label className="flex flex-col text-sm text-slate-300 gap-1">
            <span>Opening cash float (optional)</span>
            <input type="number" name="openingCash" step="0.01" min="0" defaultValue="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-white" />
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
            Open Session
          </button>
        </form>
      </div>
    );
  }

  const requested = sp.game;
  let activeGameId: string | "all";
  if (requested === "all") {
    activeGameId = "all";
  } else if (requested && session.games.some((g) => g.id === requested)) {
    activeGameId = requested;
  } else if (session.games.length === 1) {
    activeGameId = session.games[0].id;
  } else {
    activeGameId = "all";
  }

  const formGameId =
    activeGameId === "all"
      ? (session.games.find((g) => g.status === "OPEN") ?? session.games[0]).id
      : activeGameId;

  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true } });
  const tables = await prisma.table.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-3">
      <header className="flex justify-between items-center flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Tonight's Session</h2>
          <div className="text-xs text-slate-500">
            opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
            {" · opening cash "}<Money amount={session.openingCash.toString()} />
          </div>
        </div>
        <Link href="/close" className="text-red-400 border border-red-900 rounded px-3 py-1.5 text-sm hover:bg-red-950/40">
          Close session…
        </Link>
      </header>

      <GameSwitcher games={session.games} activeGameId={activeGameId} />

      <AccountStrip sessionId={session.id} activeGameId={activeGameId} />

      <div className="grid grid-cols-[1fr_320px] gap-3 flex-1 min-h-0">
        <div className="overflow-auto">
          <TransactionStream sessionId={session.id} activeGameId={activeGameId} players={players} tables={tables} />
        </div>
        <div className="flex flex-col gap-3 overflow-auto">
          <QuickActions sessionId={session.id} gameId={formGameId} />
          <GameManager sessionId={session.id} games={session.games} />
          <DropTracker sessionId={session.id} />
        </div>
      </div>
    </div>
  );
}
