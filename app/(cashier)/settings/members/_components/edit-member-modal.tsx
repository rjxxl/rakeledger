"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { updateMemberAction } from "../_actions";

interface Row {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: ClubMembershipRole;
  status: ClubMembershipStatus;
  isSelf: boolean;
}

interface Props {
  row: Row;
  callerRole: ClubMembershipRole;
  onClose: () => void;
}

export function EditMemberModal({ row, callerRole, onClose }: Props) {
  const [name, setName] = useState(row.name);
  const [role, setRole] = useState<ClubMembershipRole>(row.role);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ADMIN can't promote-to-OWNER and can't touch OWNER (already filtered before reaching this modal,
  // but keep the role list trimmed for safety).
  const roleOptions: ClubMembershipRole[] =
    callerRole === "OWNER"
      ? ["OWNER", "ADMIN", "CASHIER", "RUNNER"]
      : ["ADMIN", "CASHIER", "RUNNER"];

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("membershipId", row.id);
      fd.set("name", name);
      fd.set("role", role);
      await updateMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-amber-500 font-semibold mb-4">Edit member</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Email <span className="text-xs text-slate-500">(read-only)</span>
            <input
              type="email"
              value={row.email}
              readOnly
              className="bg-black/20 border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClubMembershipRole)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-slate-400 text-sm px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !name}
              className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
