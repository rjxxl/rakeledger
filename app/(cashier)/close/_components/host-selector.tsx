"use client";

import type { UserRole } from "@prisma/client";

interface CandidateStaff {
  id: string;
  name: string;
  role: UserRole;
}

interface Props {
  candidateStaff: CandidateStaff[];
  selectedIds: Set<string>;
  onToggle: (userId: string) => void;
}

export function HostSelector({ candidateStaff, selectedIds, onToggle }: Props) {
  if (candidateStaff.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        No staff in this club yet. Add staff on the Staff page first.
      </p>
    );
  }
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <ul className="flex flex-col gap-1.5">
        {candidateStaff.map((s) => {
          const checked = selectedIds.has(s.id);
          return (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`host-${s.id}`}
                checked={checked}
                onChange={() => onToggle(s.id)}
                className="cursor-pointer"
              />
              <label htmlFor={`host-${s.id}`} className="cursor-pointer flex-1">
                {s.name}
              </label>
              <span className="text-xs text-slate-500 uppercase tracking-wider">
                {s.role}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
