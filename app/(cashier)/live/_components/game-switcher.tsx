import Link from "next/link";

interface Game {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  stakes: string | null;
}

interface GameSwitcherProps {
  games: Game[];
  activeGameId: string | "all";
}

export function GameSwitcher({ games, activeGameId }: GameSwitcherProps) {
  const baseClass = "px-3 py-1.5 rounded-full text-sm border transition";
  const activeClass = "bg-amber-500/15 border-amber-500 text-amber-500";
  const inactiveClass = "bg-[var(--color-bg)] border-[var(--color-border)] text-slate-400 hover:text-white hover:border-slate-500";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link href="/live?game=all" className={`${baseClass} ${activeGameId === "all" ? activeClass : inactiveClass}`}>
        All games
      </Link>
      {games.map((g) => (
        <Link
          key={g.id}
          href={`/live?game=${g.id}`}
          className={`${baseClass} ${activeGameId === g.id ? activeClass : inactiveClass}`}
        >
          {g.name}
          {g.stakes && <span className="text-xs text-slate-500 ml-1">{g.stakes}</span>}
          {g.status === "CLOSED" && <span className="text-xs text-slate-500 ml-1">(closed)</span>}
        </Link>
      ))}
    </div>
  );
}
