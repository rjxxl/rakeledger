import { getDropTracker } from "@/lib/drops/last-drop";
import { formatLocalTime } from "@/lib/format";
import { StaffNameTrigger } from "./staff-name-trigger";

interface Props {
  sessionId: string;
}

// NOTE: This timestamp comparison runs at server-render time. The label freezes until the next
// page revalidate (which fires from any transaction Server Action via `revalidatePath("/live")`).
// In practice the cashier records transactions throughout the night, so this stays fresh enough.
// If a session goes 20+ minutes with zero activity, the displayed badge can be stale until the
// next interaction. Plan 2's SSE refresh would make this live.
function ageColor(timestamp: Date | null): { label: string; cls: string } {
  if (!timestamp) return { label: "no drop yet", cls: "text-red-400" };
  const minutesAgo = (Date.now() - timestamp.getTime()) / 60_000;
  if (minutesAgo < 60) return { label: formatLocalTime(timestamp), cls: "text-slate-300" };
  if (minutesAgo < 90) return { label: formatLocalTime(timestamp) + " ⚠", cls: "text-amber-400" };
  return { label: formatLocalTime(timestamp) + " ⚠", cls: "text-red-400" };
}

export async function DropTracker({ sessionId }: Props) {
  const entries = await getDropTracker(sessionId);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Drop tracker</h4>
      <ul className="text-xs flex flex-col gap-1">
        {entries.map((e) => {
          const isDealer = e.staffRole === "DEALER";
          const tracked = isDealer ? e.lastRakeDrop : e.lastTipDrop;
          const { label, cls } = ageColor(tracked);
          return (
            <li key={e.staffId} className="flex justify-between items-center px-2 py-1 rounded hover:bg-white/5">
              <StaffNameTrigger sessionId={sessionId} staffId={e.staffId} staffName={e.staffName} />
              <span className={`font-mono ${cls}`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
