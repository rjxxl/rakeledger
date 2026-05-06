"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import {
  recordStaffAdvance, recordFnbCost, recordDrawerAdjust, recordChipFloatAdjust,
} from "../../_actions/transactions";

interface MiscModalClientProps {
  sessionId: string;
  gameId: string;
  staff: Array<{ id: string; name: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  staff: Array<{ id: string; name: string }>;
}

function MiscForms({ close, sessionId, gameId, staff }: FormProps) {
  const toast = useToast();

  const staffAdvance = useFormAction(recordStaffAdvance, {
    onSuccess: (fd) => {
      toast.show(`Staff advance $${fd.get("amount")} recorded`);
      close();
    },
  });
  const fnb = useFormAction(recordFnbCost, {
    onSuccess: (fd) => {
      toast.show(`F&B cost $${fd.get("amount")} recorded`);
      close();
    },
  });
  const drawer = useFormAction(recordDrawerAdjust, {
    onSuccess: (fd) => {
      toast.show(`Drawer adjust $${fd.get("amount")} recorded`);
      close();
    },
  });
  const chipFloat = useFormAction(recordChipFloatAdjust, {
    onSuccess: (fd) => {
      toast.show(`Chip float adjust $${fd.get("amount")} recorded`);
      close();
    },
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <form onSubmit={staffAdvance.onSubmit} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Staff advance</h3>
        <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm">
          <option value="">— recipient —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input name="amount" type="number" step="0.01" min="0.01" required placeholder="amount"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
        <input name="note" required placeholder="reason"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
        {staffAdvance.error && <p className="text-red-400 text-xs">{staffAdvance.error}</p>}
        <button type="submit" disabled={staffAdvance.pending}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm hover:bg-amber-400 disabled:opacity-50">
          Record
        </button>
      </form>

      <form onSubmit={fnb.onSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">F&amp;B cost</h3>
        <input name="amount" type="number" step="0.01" min="0.01" required placeholder="amount"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
        <input name="note" required placeholder="vendor / what"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
        {fnb.error && <p className="text-red-400 text-xs">{fnb.error}</p>}
        <button type="submit" disabled={fnb.pending}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm hover:bg-amber-400 disabled:opacity-50">
          Record
        </button>
      </form>

      <form onSubmit={drawer.onSubmit} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4 pt-3 border-t border-[var(--color-border)]">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Drawer adjust</h3>
        <p className="text-xs text-slate-500">Signed amount: + over, − short.</p>
        <input name="amount" type="number" step="0.01" required placeholder="e.g. -40 or 25"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
        <input name="note" required placeholder="reason"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
        {drawer.error && <p className="text-red-400 text-xs">{drawer.error}</p>}
        <button type="submit" disabled={drawer.pending}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm hover:bg-amber-400 disabled:opacity-50">
          Record
        </button>
      </form>

      <form onSubmit={chipFloat.onSubmit} className="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)]">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 text-sm">Chip float adjust</h3>
        <p className="text-xs text-slate-500">Signed: + extra chips found, − chips short.</p>
        <input name="amount" type="number" step="0.01" required placeholder="e.g. -50"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
        <input name="note" required placeholder="reason"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
        {chipFloat.error && <p className="text-red-400 text-xs">{chipFloat.error}</p>}
        <button type="submit" disabled={chipFloat.pending}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm hover:bg-amber-400 disabled:opacity-50">
          Record
        </button>
      </form>
    </div>
  );
}

export function MiscModalClient({ trigger, ...rest }: MiscModalClientProps) {
  return (
    <Modal trigger={trigger} title="⋯ Other" description="Staff advance, F&B cost, drawer adjust, chip float adjust." wide>
      {(close) => <MiscForms close={close} {...rest} />}
    </Modal>
  );
}
