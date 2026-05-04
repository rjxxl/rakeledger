import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";
import { AccountStrip } from "./_components/account-strip";
import { BuyInForm } from "./_components/tx-buyin-form";
import { CashOutForm } from "./_components/tx-cashout-form";
import { RakeForm } from "./_components/tx-rake-form";
import { TransactionStream } from "./_components/transaction-stream";

export default async function LiveSessionPage() {
  const session = await getOpenSession();

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
            <input
              type="number"
              name="openingCash"
              step="0.01"
              min="0"
              defaultValue="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-white"
            />
          </label>
          <button
            type="submit"
            className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400"
          >
            Open Session
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Tonight's Session</h2>
        <div className="text-sm text-slate-500">
          opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
          {" · "}
          opening cash <Money amount={session.openingCash.toString()} />
        </div>
      </header>
      <AccountStrip sessionId={session.id} />
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <TransactionStream sessionId={session.id} />
        <div className="flex flex-col gap-4">
          <BuyInForm sessionId={session.id} gameId={session.games[0].id} />
          <CashOutForm sessionId={session.id} gameId={session.games[0].id} />
          <RakeForm sessionId={session.id} gameId={session.games[0].id} />
        </div>
      </div>
    </div>
  );
}
