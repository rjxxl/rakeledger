import { Money } from "@/components/money";
import { getAccountBalance } from "@/lib/ledger/balance";
import { prisma } from "@/lib/db";
import { filterTiles, type TileWithBalance } from "@/lib/ledger/tile-filter";
import type { AccountType } from "@prisma/client";

interface AccountStripProps {
  sessionId: string;
  activeGameId: string | "all";
}

interface TileDef {
  account: AccountType;
  label: string;
}

const SHARED_TILES: TileDef[] = [
  { account: "CASH_DRAWER", label: "Cash drawer" },
  { account: "ZELLE", label: "Zelle" },
  { account: "VENMO", label: "Venmo" },
  { account: "CASHAPP", label: "CashApp" },
  { account: "APPLE_PAY", label: "Apple Pay" },
  { account: "MARKER_OUTSTANDING", label: "Markers out" },
  { account: "CHIP_FLOAT", label: "Chip float" },
  { account: "TIP_POOL", label: "Tip pool" },
];

const GAME_TILES: TileDef[] = [
  { account: "RAKE_POOL", label: "Rake" },
  { account: "PROMO_POOL", label: "Promo" },
  { account: "TOURNAMENT_POOL", label: "Tournament" },
];

export async function AccountStrip({ sessionId, activeGameId }: AccountStripProps) {
  const games = await prisma.game.findMany({ where: { sessionId }, orderBy: { openedAt: "asc" } });

  const sharedBalances: TileWithBalance[] = await Promise.all(
    SHARED_TILES.map(async (t) => ({
      account: t.account,
      label: t.label,
      balance: await getAccountBalance({ account: t.account, sessionId }),
    }))
  );

  const gameTilesToRender =
    activeGameId === "all"
      ? games.flatMap((g) =>
          GAME_TILES.map((t) => ({ account: t.account, label: `${t.label} · ${g.name}`, gameId: g.id }))
        )
      : GAME_TILES.map((t) => ({ account: t.account, label: t.label, gameId: activeGameId }));

  const gameBalances: TileWithBalance[] = await Promise.all(
    gameTilesToRender.map(async (t) => ({
      account: t.account,
      label: t.label,
      gameId: t.gameId,
      balance: await getAccountBalance({ account: t.account, sessionId, gameId: t.gameId }),
    }))
  );

  const visible = filterTiles([...sharedBalances, ...gameBalances]);

  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
      {visible.map((tile, i) => (
        <div
          key={`${tile.account}-${tile.gameId ?? "shared"}-${i}`}
          className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3"
        >
          <div className="text-[0.65rem] uppercase tracking-wider text-slate-500 truncate">{tile.label}</div>
          <div className="font-mono tabular-nums text-base font-semibold mt-1">
            <Money amount={tile.balance.toString()} />
          </div>
        </div>
      ))}
    </div>
  );
}
