import { Modal } from "@/components/modal";
import {
  recordStaffAdvance, recordFnbCost, recordDrawerAdjust, recordChipFloatAdjust,
} from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MiscModal({ sessionId, gameId, trigger }: Props) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS", "RUNNER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });

  return (
    <Modal trigger={trigger} title="⋯ Other" description="Staff advance, F&B cost, drawer adjust, chip float adjust." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={recordStaffAdvance} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4">
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
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordFnbCost} className="flex flex-col gap-2">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">F&amp;B cost</h3>
          <input name="amount" type="number" step="0.01" min="0.01" required placeholder="amount"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="vendor / what"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordDrawerAdjust} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4 pt-3 border-t border-[var(--color-border)]">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Drawer adjust</h3>
          <p className="text-xs text-slate-500">Signed amount: + over, − short.</p>
          <input name="amount" type="number" step="0.01" required placeholder="e.g. -40 or 25"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="reason"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordChipFloatAdjust} className="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)]">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Chip float adjust</h3>
          <p className="text-xs text-slate-500">Signed: + extra chips found, − chips short.</p>
          <input name="amount" type="number" step="0.01" required placeholder="e.g. -50"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="reason"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>
      </div>
    </Modal>
  );
}
