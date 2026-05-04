import { Money } from "@/components/money";
import { prisma } from "@/lib/db";

interface TransactionStreamProps {
  sessionId: string;
}

export async function TransactionStream({ sessionId }: TransactionStreamProps) {
  const txs = await prisma.transaction.findMany({
    where: { sessionId },
    include: { player: true, staff: true, table: true, createdBy: true, ledgerEntries: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (txs.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 text-center text-slate-500 text-sm">
        No transactions yet. Use the forms on the right to record one.
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
          const sign = tx.type === "CASH_OUT" || tx.type === "CLOSING_FLOAT" ? -1 : 1;
          return (
            <div key={tx.id} className="grid grid-cols-[60px_1fr_70px_90px_100px] gap-2 px-4 py-2 text-sm">
              <div className="text-xs font-mono text-slate-500">{time}</div>
              <div>
                <span className="text-slate-200">{tx.player?.displayName ?? tx.staff?.name ?? "—"}</span>
                {tx.table && <span className="text-slate-500"> · {tx.table.name}</span>}
                <div className="text-xs text-slate-500">{tx.type.toLowerCase()}</div>
              </div>
              <div className="text-xs text-slate-400 self-center text-center bg-[var(--color-bg)] rounded px-1.5 py-0.5">
                {tx.method.toLowerCase()}
              </div>
              <div className="font-mono text-right self-center">
                <Money amount={(sign * Number(tx.amount.toString())).toString()} signed />
              </div>
              <div className="text-xs text-slate-500 self-center text-right">{tx.createdBy.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
