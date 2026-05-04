import { redirect } from "next/navigation";
import { getOpenSession, closeSession } from "../_actions/session";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import { Money } from "@/components/money";

export default async function ClosePage() {
  const session = await getOpenSession();
  if (!session) redirect("/live");

  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);

  // Compute expected balances for the form
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

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Close Session</h2>
      <p className="text-sm text-slate-400 mb-4">
        Count each account and enter the actual amount. Variances are recorded but allowed —
        they appear in tonight's <code>SessionAccountClose</code> rows for review.
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
                      <input
                        type="number"
                        step="0.01"
                        name={`counted_${account}_${game.id}`}
                        defaultValue={expected[`${account}_${game.id}`]}
                        className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right"
                      />
                    </td>
                  </tr>
                ));
              }
              return (
                <tr key={account} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 text-sm">{account.toLowerCase()}</td>
                  <td className="px-3 py-2 text-right font-mono"><Money amount={expected[account]} /></td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      name={`counted_${account}`}
                      defaultValue={expected[account]}
                      className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right"
                    />
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
    </div>
  );
}
