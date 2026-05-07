import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";
import { ToastProvider } from "@/components/toast/toast-provider";
import { auth, signOut } from "@/lib/auth";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  const session = await auth();
  return (
    <ToastProvider>
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <NavSidebar
          activePath={activePath}
          userName={session?.user?.name ?? null}
          userEmail={session?.user?.email ?? null}
          clubName={session?.user?.clubName ?? null}
          signOutAction={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}
        />
        <main className="p-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
