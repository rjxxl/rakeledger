import { Money } from "@/components/money";
import { getAccountBalance } from "@/lib/ledger/balance";
import type { AccountType } from "@prisma/client";

interface AccountStripProps {
  sessionId: string;
}

interface Tile {
  account: AccountType;
  label: string;
}

const tiles: Tile[] = [
  { account: "CASH_DRAWER", label: "Cash drawer" },
  { account: "ZELLE", label: "Zelle" },
  { account: "VENMO", label: "Venmo" },
  { account: "CASHAPP", label: "CashApp" },
  { account: "APPLE_PAY", label: "Apple Pay" },
  { account: "CHIP_FLOAT", label: "Chip float" },
  { account: "RAKE_POOL", label: "Rake pool" },
  { account: "TIP_POOL", label: "Tip pool" },
];

export async function AccountStrip({ sessionId }: AccountStripProps) {
  const balances = await Promise.all(
    tiles.map(async (t) => ({
      ...t,
      balance: await getAccountBalance({ account: t.account, sessionId }),
    }))
  );

  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
      {balances.map((tile) => (
        <div
          key={tile.account}
          className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3"
        >
          <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">{tile.label}</div>
          <div className="font-mono tabular-nums text-base font-semibold mt-1">
            <Money amount={tile.balance.toString()} />
          </div>
        </div>
      ))}
    </div>
  );
}
