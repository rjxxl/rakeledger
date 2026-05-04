"use client";

import { Modal } from "@/components/modal";
import { openGame, closeGame } from "../../_actions/games";

interface GameManagerProps {
  sessionId: string;
  games: Array<{ id: string; name: string; status: "OPEN" | "CLOSED"; stakes: string | null }>;
}

export function GameManager({ sessionId, games }: GameManagerProps) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-xs uppercase tracking-wider text-slate-400">Games</h4>
        <Modal
          title="Open new game"
          description="Add a concurrent game to this session."
          trigger={
            <button className="text-xs text-amber-500 hover:text-amber-400">+ New</button>
          }
        >
          <form action={openGame} className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Name</span>
              <input name="name" required placeholder="e.g. Hi-Stakes"
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Game type</span>
              <input name="gameType" placeholder="NL Hold'em / PLO / Mixed"
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Stakes</span>
              <input name="stakes" placeholder="1/2 / 5/10 / etc."
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <input type="hidden" name="splitType" value="even" />
            <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Open Game</button>
          </form>
        </Modal>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {games.map((g) => (
          <li key={g.id} className="flex justify-between items-center px-2 py-1 rounded hover:bg-white/5">
            <span>
              <span className="text-slate-200">{g.name}</span>
              {g.stakes && <span className="text-slate-500 ml-1">{g.stakes}</span>}
              {g.status === "CLOSED" && <span className="text-slate-500 ml-2">(closed)</span>}
            </span>
            {g.status === "OPEN" && games.filter((x) => x.status === "OPEN").length > 1 && (
              <form action={closeGame}>
                <input type="hidden" name="gameId" value={g.id} />
                <button type="submit" className="text-slate-500 hover:text-red-400 text-xs">close</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
