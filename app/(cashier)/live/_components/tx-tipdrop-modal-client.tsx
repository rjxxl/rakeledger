"use client";

import Link from "next/link";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordTipDrop } from "../../_actions/transactions";

interface TipDropModalClientProps {
  sessionId: string;
  gameId: string;
  staff: Array<{ id: string; name: string; role: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  staff: Array<{ id: string; name: string; role: string }>;
}

function TipDropForm({ close, sessionId, gameId, staff }: FormProps) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(recordTipDrop, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const staffName = staff.find((s) => s.id === fd.get("staffId"))?.name ?? "staff";
      toast.show(`Tip drop $${amount} recorded for ${staffName}`);
      close();
    },
  });

  if (staff.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          No dealers or waitresses have been added yet. Tip drops need a recipient.
        </p>
        <Link
          href="/staff"
          onClick={close}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 text-center"
        >
          Go to Staff
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Recipient</span>
        <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase()})</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount (chips)</span>
        <input name="amount" type="number" step="0.01" min="0.01" required
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Tip Drop
      </button>
    </form>
  );
}

export function TipDropModalClient({ trigger, ...rest }: TipDropModalClientProps) {
  return (
    <Modal trigger={trigger} title="+ Tip drop" description="Dealer or waitress drops accumulated tip chips at the cage.">
      {(close) => <TipDropForm close={close} {...rest} />}
    </Modal>
  );
}
