"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordRake } from "../../_actions/transactions";

interface RakeModalClientProps {
  sessionId: string;
  gameId: string;
  dealers: Array<{ id: string; name: string }>;
  tables: Array<{ id: string; name: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  dealers: Array<{ id: string; name: string }>;
  tables: Array<{ id: string; name: string }>;
}

function RakeForm({ close, sessionId, gameId, dealers, tables }: FormProps) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(recordRake, {
    onSuccess: (fd) => {
      const amount = fd.get("amount");
      const staffId = fd.get("staffId") as string;
      const staffName = staffId ? dealers.find((d) => d.id === staffId)?.name : null;
      toast.show(`Rake $${amount} recorded${staffName ? ` for ${staffName}` : ""}`);
      close();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Dealer (optional)</span>
        <select name="staffId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— none —</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Table (optional)</span>
        <select name="tableId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— none —</option>
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Rake amount (chips)</span>
        <input name="amount" type="number" step="0.01" min="0.01" required
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Rake
      </button>
    </form>
  );
}

export function RakeModalClient({ trigger, ...rest }: RakeModalClientProps) {
  return (
    <Modal trigger={trigger} title="+ Rake drop" description="Dealer drops accumulated rake chips at the cage.">
      {(close) => <RakeForm close={close} {...rest} />}
    </Modal>
  );
}
