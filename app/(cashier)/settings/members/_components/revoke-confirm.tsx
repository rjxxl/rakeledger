"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { revokeMemberAction } from "../_actions";

interface Row {
  id: string;
  name: string;
  email: string;
  role: ClubMembershipRole;
  status: ClubMembershipStatus;
}

interface Props {
  row: Row;
  onClose: () => void;
}

export function RevokeConfirm({ row, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("membershipId", row.id);
      await revokeMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-red-400 font-semibold mb-2">Revoke {row.name}?</h3>
        <p className="text-sm text-slate-400 mb-4">
          They will lose access on next sign-in. Existing sessions remain valid until they expire (up to 30 days).
        </p>
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-400 text-sm px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={submitting}
            className="bg-red-600 text-white font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {submitting ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
