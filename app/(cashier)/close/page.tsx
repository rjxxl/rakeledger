import { redirect } from "next/navigation";
import Decimal from "decimal.js";
import { getOpenSession, closeSession } from "../_actions/session";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import { Money } from "@/components/money";
import { computeTipPayouts } from "@/lib/payouts/tip-payout";
import { TipPayoutStep } from "./_components/tip-payout-step";
import { HouseTaxStep } from "./_components/house-tax-step";
import { RakeDistributionStep } from "./_components/rake-distribution-step";
import { WalksReturnsStep } from "./_components/walks-returns-step";
import { getPlayersWithUnresolvedChips, getCandidateWalksForReturn } from "../_actions/walks";
import { prisma } from "@/lib/db";

export default async function ClosePage() {
  const session = await getOpenSession();
  if (!session) redirect("/live");

  // 1. Tip payouts
  const tipRows = await computeTipPayouts(session.id);

  // 2. House tax pool balance
  const houseTaxPool = await getAccountBalance({ account: "HOUSE_TAX_POOL", sessionId: session.id });

  // 3. Per-game rake pools
  const rakePerGame = await Promise.all(
    session.games.map(async (g) => ({
      gameId: g.id,
      gameName: g.name,
      total: await getAccountBalance({ account: "RAKE_POOL", sessionId: session.id, gameId: g.id }),
    }))
  );

  const owners = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "CASHIER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const hosts = await prisma.user.findMany({
    where: { role: { in: ["RUNNER", "CASHIER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  function evenSplit(total: Decimal, count: number): Decimal[] {
    if (count === 0) return [];
    const baseDecimal = total.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const totals = Array(count).fill(baseDecimal);
    const allocated = baseDecimal.mul(count);
    const remainder = total.sub(allocated);
    if (!remainder.equals(0) && totals.length > 0) {
      totals[0] = totals[0].add(remainder);
    }
    return totals;
  }

  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);
  const expected: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    if (GAME_SCOPED.has(account)) {
      for (const game of session.games) {
        const bal = await getAccountBalance({ account, sessionId: session.id, gameId: game.id });
        expected[`${account}_${game.id}`] = bal.toString();
      }
    } else {
      const bal = await getAccountBalance({ account, sessionId: session.id });
      expected[account] = bal.toString();
    }
  }

  const houseTaxRecipients = (() => {
    const splits = evenSplit(houseTaxPool, owners.length);
    return owners.map((o, i) => ({
      userId: o.id,
      userName: o.name,
      amount: splits[i] ?? new Decimal(0),
      method: "CASH" as const,
    }));
  })();

  const rakeStepsData = rakePerGame.map((rp) => {
    const splits = evenSplit(rp.total, hosts.length);
    return {
      ...rp,
      recipients: hosts.map((h, i) => ({
        userId: h.id,
        userName: h.name,
        amount: splits[i] ?? new Decimal(0),
        method: "CASH" as const,
      })),
    };
  });

  const defaultGameId = session.games[0].id;

  const chipFloatBalance = await getAccountBalance({ account: "CHIP_FLOAT", sessionId: session.id });
  const candidatePlayers = await getPlayersWithUnresolvedChips(session.id);
  const candidateWalks = await getCandidateWalksForReturn(session.id);

  return (
    <div className="max-w-4xl flex flex-col gap-6 pb-12">
      <h2 className="text-lg font-semibold">Close Session</h2>
      <p className="text-sm text-slate-400">
        Complete each step in order. The final &quot;Close Session&quot; button at the bottom freezes the session and records account counts.
      </p>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 1 &mdash; Pay out tips</h3>
        <TipPayoutStep sessionId={session.id} gameId={defaultGameId} rows={tipRows} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 2 &mdash; Distribute house tax pool</h3>
        <HouseTaxStep
          sessionId={session.id}
          gameId={defaultGameId}
          totalHouseTax={houseTaxPool}
          initialRecipients={houseTaxRecipients}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 3 &mdash; Distribute rake (per game)</h3>
        <div className="flex flex-col gap-3">
          {rakeStepsData.map((rs) => (
            <RakeDistributionStep
              key={rs.gameId}
              sessionId={session.id}
              gameId={rs.gameId}
              gameName={rs.gameName}
              totalRake={rs.total}
              initialRecipients={rs.recipients}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 4 &mdash; Resolve chip float (walks &amp; returns)</h3>
        <WalksReturnsStep
          sessionId={session.id}
          gameId={defaultGameId}
          chipFloatBalance={chipFloatBalance}
          candidatePlayers={candidatePlayers}
          candidateWalks={candidateWalks}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 5 &mdash; Reconcile accounts &amp; close</h3>
        <p className="text-xs text-slate-500 mb-3">
          Count each account and enter the actual amount. Variances are recorded but allowed.
        </p>
        <form action={closeSession} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={session.id} />
          <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg">
            <thead>
              <tr className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
                <th className="px-3 py-2 text-left">Account</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNTS.map((account) => {
                if (GAME_SCOPED.has(account)) {
                  return session.games.map((game) => (
                    <tr key={`${account}_${game.id}`} className="border-t border-[var(--color-border)]">
                      <td className="px-3 py-2 text-sm">{account.toLowerCase()} ({game.name})</td>
                      <td className="px-3 py-2 text-right font-mono"><Money amount={expected[`${account}_${game.id}`]} /></td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="0.01"
                          name={`counted_${account}_${game.id}`}
                          defaultValue={expected[`${account}_${game.id}`]}
                          className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right" />
                      </td>
                    </tr>
                  ));
                }
                return (
                  <tr key={account} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 text-sm">{account.toLowerCase()}</td>
                    <td className="px-3 py-2 text-right font-mono"><Money amount={expected[account]} /></td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01"
                        name={`counted_${account}`}
                        defaultValue={expected[account]}
                        className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="submit" className="bg-red-600 text-white font-semibold rounded px-4 py-2 self-end">
            Close Session
          </button>
        </form>
      </section>
    </div>
  );
}
