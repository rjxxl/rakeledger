"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { issueMarker, repayMarker } from "../../_actions/transactions";

interface OpenMarker {
  id: string;
  playerId: string;
  playerName: string;
  amount: string;
  repaidAmount: string;
}

interface MarkerModalClientProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  openMarkers: OpenMarker[];
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  openMarkers: OpenMarker[];
}

function MarkerForms({ close, sessionId, gameId, players, openMarkers }: FormProps) {
  const toast = useToast();

  const issue = useFormAction(issueMarker, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Marker $${amount} issued to ${playerName}`);
      close();
    },
  });

  const repay = useFormAction(repayMarker, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const markerId = fd.get("markerId") as string;
      const marker = openMarkers.find((m) => m.id === markerId);
      const playerName = marker?.playerName ?? "player";
      toast.show(`Marker repayment $${amount} from ${playerName}`);
      close();
    },
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <form onSubmit={issue.onSubmit} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Issue marker</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Collateral note</span>
          <input name="collateral" placeholder="e.g. gold watch"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        {issue.error && <p className="text-red-400 text-xs">{issue.error}</p>}
        <button type="submit" disabled={issue.pending}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
          Issue
        </button>
      </form>

      <form onSubmit={repay.onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Repay marker</h3>
        {openMarkers.length === 0 ? (
          <p className="text-xs text-slate-500">No open markers to repay.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Open marker</span>
              <select name="markerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                <option value="">— select —</option>
                {openMarkers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.playerName} — ${m.amount}
                    {m.repaidAmount !== "0" && ` (paid $${m.repaidAmount})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Payment</span>
              <input name="amount" type="number" step="0.01" min="0.01" required
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Method</span>
              <select name="method" defaultValue="CASH"
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                <option value="CASH">Cash</option>
                <option value="ZELLE">Zelle</option>
                <option value="VENMO">Venmo</option>
                <option value="CASHAPP">CashApp</option>
                <option value="APPLE_PAY">Apple Pay</option>
              </select>
            </label>
            {repay.error && <p className="text-red-400 text-xs">{repay.error}</p>}
            <button type="submit" disabled={repay.pending}
              className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
              Record Repayment
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export function MarkerModalClient({ trigger, ...rest }: MarkerModalClientProps) {
  return (
    <Modal trigger={trigger} title="$ Marker" description="Issue a new marker, or repay an existing one." wide>
      {(close) => <MarkerForms close={close} {...rest} />}
    </Modal>
  );
}
