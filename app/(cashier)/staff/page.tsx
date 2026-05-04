import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function StaffPage() {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS", "RUNNER"] } },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Staff</h2>
        <Link href="/staff/new" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">
          + New Staff
        </Link>
      </header>
      {staff.length === 0 ? (
        <p className="text-slate-500">No staff yet. Add dealers, waitresses, or runners.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {staff.map((s) => (
            <li key={s.id}>
              <Link href={`/staff/${s.id}`} className="block px-4 py-3 hover:bg-white/5">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {s.role.toLowerCase()}
                  {s.tipTaxRate && ` · tax ${(Number(s.tipTaxRate) * 100).toFixed(0)}%`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
