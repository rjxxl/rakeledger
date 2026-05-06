"use client";

import { Money } from "@/components/money";
import type { ActivityRow } from "../../_actions/activity";

export interface SummaryItem {
  label: string;
  value: string; // numeric string
  emphasize?: boolean;
}

interface PanelProps {
  title: string;
  rows: ActivityRow[];
  summary: SummaryItem[];
}

export function SessionActivityPanel({ title, rows, summary }: PanelProps) {
  return (
    <div className="flex flex-col gap-4 max-h-[70vh]">
      <div>
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.map((s) => (
            <div key={s.label} className="bg-black/30 border border-[var(--color-border)] rounded p-2">
              <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">{s.label}</div>
              <div className={`font-mono tabular-nums text-sm mt-1 ${s.emphasize ? "text-amber-400 font-semibold" : ""}`}>
                <Money amount={s.value} signed={s.emphasize} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-auto border border-[var(--color-border)] rounded">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-sm">No activity in this session.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`px-3 py-2 text-xs grid grid-cols-[60px_1fr_70px_90px] gap-2 ${
                  r.reversesId ? "text-slate-500 italic" : ""
                }`}
              >
                <span className="font-mono text-slate-500">
                  {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>
                  <span className="text-slate-200">{r.type.toLowerCase().replace(/_/g, " ")}</span>
                  {r.gameName && <span className="text-slate-500"> · {r.gameName}</span>}
                  {r.tableName && <span className="text-slate-500"> / {r.tableName}</span>}
                  {r.staffName && <span className="text-slate-500"> · {r.staffName}</span>}
                  {r.note && <div className="text-slate-500 mt-0.5">{r.note}</div>}
                </span>
                <span className="text-center text-slate-400 bg-[var(--color-bg)] rounded px-1.5 py-0.5 self-center">
                  {r.method.toLowerCase()}
                </span>
                <span className="font-mono text-right self-center">
                  <Money amount={r.amount} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
