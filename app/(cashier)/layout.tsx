import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";
import { ToastProvider } from "@/components/toast/toast-provider";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  return (
    <ToastProvider>
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <NavSidebar activePath={activePath} />
        <main className="p-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
