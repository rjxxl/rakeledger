"use client";

import { useState } from "react";
import type { ClubMembershipRole } from "@prisma/client";
import { addMemberAction } from "../_actions";

interface Props {
  callerRole: ClubMembershipRole;
  onClose: () => void;
}

export function AddMemberModal({ callerRole, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ClubMembershipRole>("CASHIER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const roleOptions: ClubMembershipRole[] =
    callerRole === "OWNER"
      ? ["OWNER", "ADMIN", "CASHIER", "RUNNER"]
      : ["ADMIN", "CASHIER", "RUNNER"];

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("name", name);
      fd.set("role", role);
      await addMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-amber-500 font-semibold mb-4">Add member</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
              required
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
              disabled={submitting || !email || !name}
              className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
