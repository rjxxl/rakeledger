"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { AddMemberModal } from "./add-member-modal";
import { EditMemberModal } from "./edit-member-modal";
import { RevokeConfirm } from "./revoke-confirm";
import { reAddMemberAction } from "../_actions";

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
  rows: Row[];
  callerRole: ClubMembershipRole;
}

export function MembersList({ rows, callerRole }: Props) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [revokingRow, setRevokingRow] = useState<Row | null>(null);

  const active = rows.filter((r) => r.status === "ACTIVE");
  const removed = rows.filter((r) => r.status === "REMOVED");

  function canActOn(target: Row): boolean {
    // Caller can never act on themselves.
    if (target.isSelf) return false;
    // ADMIN cannot act on OWNER.
    if (callerRole === "ADMIN" && target.role === "OWNER") return false;
    return true;
  }

  async function reAdd(row: Row) {
    const fd = new FormData();
    fd.set("membershipId", row.id);
    fd.set("role", row.role);
    await reAddMemberAction(fd);
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setAdding(true)}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm"
        >
          + Add member
        </button>
      </div>

      <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm">
        <thead className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {active.map((r) => (
            <tr key={r.id} className="border-t border-[var(--color-border)]">
              <td className="px-3 py-2">{r.name}{r.isSelf && <span className="text-slate-500"> (you)</span>}</td>
              <td className="px-3 py-2">{r.role}</td>
              <td className="px-3 py-2 text-slate-400">{r.email}</td>
              <td className="px-3 py-2 text-right space-x-2">
                {canActOn(r) && (
                  <>
                    <button
                      onClick={() => setEditingRow(r)}
                      className="text-amber-500 hover:underline text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setRevokingRow(r)}
                      className="text-red-400 hover:underline text-xs"
                    >
                      Revoke
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {removed.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowRemoved((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {showRemoved ? "▾" : "▸"} Show removed ({removed.length})
          </button>
          {showRemoved && (
            <table className="w-full mt-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm opacity-60">
              <tbody>
                {removed.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="px-3 py-2 text-slate-400">{r.email}</td>
                    <td className="px-3 py-2 text-right">
                      {canActOn(r) && (
                        <button
                          onClick={() => reAdd(r)}
                          className="text-green-400 hover:underline text-xs"
                        >
                          Re-add
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {adding && (
        <AddMemberModal callerRole={callerRole} onClose={() => setAdding(false)} />
      )}
      {editingRow && (
        <EditMemberModal
          row={editingRow}
          callerRole={callerRole}
          onClose={() => setEditingRow(null)}
        />
      )}
      {revokingRow && (
        <RevokeConfirm
          row={revokingRow}
          onClose={() => setRevokingRow(null)}
        />
      )}
    </>
  );
}
