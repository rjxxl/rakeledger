"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordCashOut } from "../../_actions/transactions";

interface CashOutModalClientProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
}

function CashOutForm({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(recordCashOut, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      const n100 = parseInt((fd.get("n100") as string) ?? "0", 10) || 0;
      const n25 = parseInt((fd.get("n25") as string) ?? "0", 10) || 0;
      const n5 = parseInt((fd.get("n5") as string) ?? "0", 10) || 0;
      const n1 = parseInt((fd.get("n1") as string) ?? "0", 10) || 0;
      const total = (n100 * 100 + n25 * 25 + n5 * 5 + n1 * 1).toFixed(2);
      toast.show(`Cash-out $${total} recorded for ${playerName}`);
      close();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>
      <div className="text-xs text-slate-500 uppercase tracking-wide">Chip count</div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { name: "n100", label: "$100" },
          { name: "n25", label: "$25" },
          { name: "n5", label: "$5" },
          { name: "n1", label: "$1" },
        ].map((d) => (
          <label key={d.name} className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">{d.label}</span>
            <input type="number" name={d.name} defaultValue="0" min="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center" />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Payout method</span>
        <select name="method" required defaultValue="CASH"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="CASH">Cash</option>
          <option value="ZELLE">Zelle</option>
          <option value="VENMO">Venmo</option>
          <option value="CASHAPP">CashApp</option>
          <option value="APPLE_PAY">Apple Pay</option>
        </select>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Cash-out
      </button>
    </form>
  );
}

export function CashOutModalClient({ trigger, ...rest }: CashOutModalClientProps) {
  return (
    <Modal trigger={trigger} title="− Cash-out" description="Count chips by denomination, then payout method." wide>
      {(close) => <CashOutForm close={close} {...rest} />}
    </Modal>
  );
}
