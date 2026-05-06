"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { SessionActivityPanel, type SummaryItem } from "./session-activity-panel";
import { getPlayerSessionActivity, type PlayerActivity } from "../../_actions/activity";

interface Props {
  sessionId: string;
  playerId: string;
  playerName: string;
}

export function PlayerNameTrigger({ sessionId, playerId, playerName }: Props) {
  const [data, setData] = useState<PlayerActivity | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (data || pending) return;
    startTransition(async () => {
      const result = await getPlayerSessionActivity(sessionId, playerId);
      setData(result);
    });
  };

  const summary: SummaryItem[] = data
    ? [
        { label: "Buy-ins", value: data.totals.buyIn },
        { label: "Cash-outs", value: data.totals.cashOut },
        { label: "Markers", value: data.totals.markersIssued },
        { label: "Net cash", value: data.totals.netCash, emphasize: true },
      ]
    : [];

  return (
    <Modal
      trigger={
        <button onClick={load} className="text-slate-200 hover:text-amber-400 hover:underline cursor-pointer">
          {playerName}
        </button>
      }
      title={`${playerName} · session activity`}
      wide
    >
      {() =>
        pending && !data ? (
          <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <SessionActivityPanel title={playerName} rows={data.rows} summary={summary} />
        ) : (
          <div className="p-6 text-center text-slate-500 text-sm">Click to load</div>
        )
      }
    </Modal>
  );
}
