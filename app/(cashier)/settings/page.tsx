import Link from "next/link";
import { DenominationToggle } from "./_components/denomination-toggle";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";

export default async function SettingsPage() {
  let isAdmin = false;
  try {
    await requireAdmin();
    isAdmin = true;
  } catch (e) {
    if (!(e instanceof NotAdminError)) throw e;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Settings</h2>

      {isAdmin && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Club admin</h3>
          <Link
            href="/settings/members"
            className="block bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4 hover:border-amber-500/40"
          >
            <div className="text-amber-500 font-semibold text-sm">Members</div>
            <div className="text-xs text-slate-500 mt-1">
              Add and manage who can sign in to this club.
            </div>
          </Link>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">This device</h3>
        <p className="text-xs text-slate-500 mb-3">
          These settings are stored in this browser&apos;s local storage and don&apos;t sync across devices.
        </p>
        <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
          <DenominationToggle />
        </div>
      </section>
    </div>
  );
}
