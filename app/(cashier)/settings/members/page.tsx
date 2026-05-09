import { redirect } from "next/navigation";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";
import { prisma } from "@/lib/db";
import { MembersList } from "./_components/members-list";

export default async function MembersPage() {
  let caller;
  try {
    caller = await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) redirect("/settings");
    throw e;
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: caller.clubId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
  });

  const rows = memberships.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email!,
    role: m.role,
    status: m.status,
    isSelf: m.userId === caller.userId,
  }));

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold mb-1">Members</h2>
      <p className="text-xs text-slate-500 mb-4">
        Add and manage who can sign in to this club.
      </p>
      <MembersList rows={rows} callerRole={caller.role} />
    </div>
  );
}
