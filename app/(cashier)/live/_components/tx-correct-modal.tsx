"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { submitCorrection } from "../../_actions/corrections";

interface OriginalTx {
  id: string;
  type: string;
  amount: string;
  method: string;
  playerName: string | null;
  playerId: string | null;
  staffName: string | null;
  staffId: string | null;
  tableName: string | null;
  tableId: string | null;
  note: string | null;
}

interface Props {
  tx: OriginalTx;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  trigger: React.ReactNode;
}

const METHOD_OPTIONS: Array<[string, string]> = [
  ["CASH", "Cash"], ["ZELLE", "Zelle"], ["VENMO", "Venmo"],
  ["CASHAPP", "CashApp"], ["APPLE_PAY", "Apple Pay"], ["OTHER", "Other"],
];

// Types whose method field is structurally fixed (chip-only, cash-only, or has custom payout-shape logic).
// For these, hide the method dropdown — only amount/player/table/note are editable via correction.
const METHOD_LOCKED_TYPES = new Set([
  "RAKE", "TIP_DROP", "FREEROLL_PRIZE_PAYOUT", "CHIP_FLOAT_ADJUST",
  "JACKPOT_PAYOUT",
  "STAFF_ADVANCE", "FNB_COST", "DRAWER_COUNT_ADJUST",
]);

function CorrectForm({ close, tx, players, tables, staff }: { close: () => void; tx: OriginalTx; players: Props["players"]; tables: Props["tables"]; staff: Props["staff"] }) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(submitCorrection, {
    onSuccess: () => {
      toast.show("Correction recorded");
      close();
    },
  });

  const allowMethodEdit = !METHOD_LOCKED_TYPES.has(tx.type);
  const allowPlayerEdit = tx.playerId !== null;
  const allowStaffEdit = tx.staffId !== null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="originalId" value={tx.id} />
      <div className="text-xs text-slate-500 bg-black/30 rounded p-2">
        <div><span className="text-slate-400">Type:</span> {tx.type.toLowerCase()}</div>
        <div><span className="text-slate-400">Original amount:</span> ${tx.amount} · {tx.method.toLowerCase()}</div>
        {tx.playerName && <div><span className="text-slate-400">Player:</span> {tx.playerName}</div>}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. wrong method, miscount, wrong player"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount (leave blank to keep ${tx.amount})</span>
        <input type="number" name="amount" step="0.01" min="0.01" placeholder={tx.amount}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      {allowMethodEdit && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method (leave blank to keep {tx.method.toLowerCase()})</span>
          <select name="method" defaultValue=""
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— keep {tx.method.toLowerCase()} —</option>
            {METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      {allowPlayerEdit && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player (leave blank to keep {tx.playerName ?? "—"})</span>
          <select name="playerId" defaultValue=""
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— keep —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
      )}
      {allowStaffEdit && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Staff (leave blank to keep {tx.staffName ?? "—"})</span>
          <select name="staffId" defaultValue=""
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— keep —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Table (leave blank to keep)</span>
        <select name="tableId" defaultValue=""
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— keep —</option>
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Apply correction
      </button>
    </form>
  );
}

export function TxCorrectModal({ tx, players, tables, staff, trigger }: Props) {
  return (
    <Modal trigger={trigger} title="Correct transaction" description={`Reverses tx ${tx.id.slice(0, 8)} and records the corrected version. The original row is preserved for audit.`}>
      {(close) => <CorrectForm close={close} tx={tx} players={players} tables={tables} staff={staff} />}
    </Modal>
  );
}
