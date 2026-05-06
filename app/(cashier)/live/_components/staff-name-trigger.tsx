"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { SessionActivityPanel, type SummaryItem } from "./session-activity-panel";
import { getStaffSessionActivity, type StaffActivity } from "../../_actions/activity";

interface Props {
  sessionId: string;
  staffId: string;
  staffName: string;
}

export function StaffNameTrigger({ sessionId, staffId, staffName }: Props) {
  const [data, setData] = useState<StaffActivity | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (data || pending) return;
    startTransition(async () => {
      const result = await getStaffSessionActivity(sessionId, staffId);
      setData(result);
    });
  };

  const summary: SummaryItem[] = data
    ? [
        { label: "Rake drops", value: data.totals.rakeDrops },
        { label: "Tip drops", value: data.totals.tipDrops },
        { label: "Drop count", value: String(data.totals.dropCount), raw: true },
        {
          label: "Last drop",
          value: data.totals.lastDropAt
            ? new Date(data.totals.lastDropAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—",
          raw: true,
        },
      ]
    : [];

  return (
    <Modal
      trigger={
        <button onClick={load} className="text-slate-200 hover:text-amber-400 hover:underline cursor-pointer">
          {staffName}
        </button>
      }
      title={`${staffName} · session activity`}
      wide
    >
      {() =>
        pending && !data ? (
          <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <SessionActivityPanel title={staffName} rows={data.rows} summary={summary} />
        ) : (
          <div className="p-6 text-center text-slate-500 text-sm">Click to load</div>
        )
      }
    </Modal>
  );
}
