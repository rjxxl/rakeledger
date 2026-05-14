"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface MembershipOption {
  clubId: string;
  clubName: string;
}

interface Props {
  activeClubId: string | null;
  activeClubName: string | null;
  memberships: MembershipOption[];
}

/**
 * Dropdown that lets users with multiple active club memberships swap their
 * `activeClubId` mid-session. Calls NextAuth's `update()` to mutate the JWT
 * server-side via the `jwt({ trigger: "update" })` callback in lib/auth.ts.
 *
 * Renders nothing when the user has only one membership — single-club users
 * see the same display they had before this component existed.
 */
export function ClubSwitcher({ activeClubId, activeClubName, memberships }: Props) {
  const { update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (memberships.length <= 1) {
    return activeClubName ? (
      <div className="text-amber-500 mt-1 truncate" title={activeClubName}>
        {activeClubName}
      </div>
    ) : null;
  }

  async function switchTo(clubId: string) {
    setOpen(false);
    startTransition(async () => {
      await update({ activeClubId: clubId });
      router.refresh();
    });
  }

  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center justify-between gap-1 w-full text-amber-500 hover:text-amber-400 truncate disabled:opacity-50"
        title={activeClubName ?? ""}
      >
        <span className="truncate">{isPending ? "Switching…" : activeClubName ?? "(no club)"}</span>
        <span className="text-slate-500 text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded shadow-lg z-30 max-h-60 overflow-auto"
        >
          {memberships.map((m) => {
            const isActive = m.clubId === activeClubId;
            return (
              <li key={m.clubId}>
                <button
                  type="button"
                  onClick={() => !isActive && switchTo(m.clubId)}
                  disabled={isActive}
                  role="option"
                  aria-selected={isActive}
                  className={`w-full text-left px-2 py-1.5 truncate ${
                    isActive
                      ? "bg-amber-500/10 text-amber-500 cursor-default"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {m.clubName}
                  {isActive && <span className="text-slate-500 text-[10px] ml-1">(active)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
