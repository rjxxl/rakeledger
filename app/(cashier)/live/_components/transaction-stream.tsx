import Decimal from "decimal.js";
import { Money } from "@/components/money";
import { prisma } from "@/lib/db";
import type { AccountType } from "@prisma/client";
import { PlayerNameTrigger } from "./player-name-trigger";

interface TransactionStreamProps {
  sessionId: string;
  activeGameId: string | "all";
}

const HEADLINE_ACCOUNTS: AccountType[] = [
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
  "RAKE_POOL", "TIP_POOL", "PROMO_POOL", "MARKER_OUTSTANDING", "CHIP_FLOAT",
];

function pickHeadlineDelta(ledgerEntries: Array<{ account: AccountType; delta: { toString(): string } }>) {
  for (const account of HEADLINE_ACCOUNTS) {
    const entry = ledgerEntries.find((e) => e.account === account);
    if (entry) return new Decimal(entry.delta.toString());
  }
  return ledgerEntries.length > 0 ? new Decimal(ledgerEntries[0].delta.toString()) : new Decimal(0);
}

export async function TransactionStream({ sessionId, activeGameId }: TransactionStreamProps) {
  const txs = await prisma.transaction.findMany({
    where: {
      sessionId,
      ...(activeGameId !== "all" ? { gameId: activeGameId } : {}),
    },
    include: { player: true, staff: true, table: true, createdBy: true, ledgerEntries: true, game: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (txs.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 text-center text-slate-500 text-sm">
        No transactions yet. Use the Quick Actions on the right to record one.
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-[var(--color-border)] flex justify-between items-center">
        <h4 className="font-semibold text-sm">Transaction stream</h4>
        <span className="text-xs text-slate-500">{txs.length} shown</span>
      </header>
      <div className="divide-y divide-[var(--color-border)]">
        {txs.map((tx) => {
          const time = new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const headlineDelta = pickHeadlineDelta(tx.ledgerEntries);
          return (
            <div key={tx.id} className="grid grid-cols-[60px_1fr_70px_90px_100px] gap-2 px-4 py-2 text-sm">
              <div className="text-xs font-mono text-slate-500">{time}</div>
              <div>
                {tx.player ? (
                  <PlayerNameTrigger sessionId={sessionId} playerId={tx.player.id} playerName={tx.player.displayName} />
                ) : (
                  <span className="text-slate-200">{tx.staff?.name ?? "—"}</span>
                )}
                {tx.game && <span className="text-slate-500"> · {tx.game.name}</span>}
                {tx.table && <span className="text-slate-500"> / {tx.table.name}</span>}
                <div className="text-xs text-slate-500">{tx.type.toLowerCase()}</div>
              </div>
              <div className="text-xs text-slate-400 self-center text-center bg-[var(--color-bg)] rounded px-1.5 py-0.5">
                {tx.method.toLowerCase()}
              </div>
              <div className="font-mono text-right self-center">
                <Money amount={headlineDelta.toString()} signed />
              </div>
              <div className="text-xs text-slate-500 self-center text-right">{tx.createdBy.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
