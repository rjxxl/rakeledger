import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";
import { ToastProvider } from "@/components/toast/toast-provider";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  const session = await auth();

  // Fetch all of the user's ACTIVE memberships so the sidebar's club switcher can
  // list them. Single-club users get an empty list, the switcher renders a plain
  // label, no behavior change. Multi-club users get a real dropdown.
  const memberships = session?.user?.id
    ? await prisma.clubMembership.findMany({
        where: { userId: session.user.id, status: "ACTIVE" },
        include: { club: { select: { id: true, name: true } } },
        orderBy: { club: { name: "asc" } },
      })
    : [];

  const membershipOptions = memberships.map((m) => ({
    clubId: m.club.id,
    clubName: m.club.name,
  }));

  return (
    <ToastProvider>
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <NavSidebar
          activePath={activePath}
          userName={session?.user?.name ?? null}
          userEmail={session?.user?.email ?? null}
          activeClubId={session?.user?.clubId ?? null}
          activeClubName={session?.user?.clubName ?? null}
          memberships={membershipOptions}
          signOutAction={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}
        />
        <main className="p-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
