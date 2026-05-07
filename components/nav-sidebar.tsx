import Link from "next/link";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const topItems: NavItem[] = [
  { href: "/live", label: "Live Session", icon: "🌙" },
  { href: "/players", label: "Players", icon: "🃏" },
  { href: "/staff", label: "Staff", icon: "👥" },
  { href: "/tables", label: "Tables", icon: "🪑" },
];

const bottomItems: NavItem[] = [
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function NavLink({ item, activePath }: { item: NavItem; activePath: string }) {
  const active = activePath === item.href || activePath.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2 px-2 py-2 rounded text-sm ${
        active ? "bg-amber-500/10 text-amber-500" : "text-slate-300 hover:bg-white/5"
      }`}
    >
      <span>{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

interface NavSidebarProps {
  activePath: string;
  userName?: string | null;
  userEmail?: string | null;
  clubName?: string | null;
  signOutAction?: () => Promise<void>;
}

export function NavSidebar({
  activePath,
  userName = null,
  userEmail = null,
  clubName = null,
  signOutAction,
}: NavSidebarProps) {
  return (
    <aside className="w-[220px] bg-[var(--color-panel)] border-r border-[var(--color-border)] p-4 flex flex-col">
      <div className="text-amber-500 font-bold text-base mb-5 pb-3 border-b border-[var(--color-border)]">
        ♠ RakeLedger
      </div>
      <nav className="flex flex-col gap-1">
        {topItems.map((item) => <NavLink key={item.href} item={item} activePath={activePath} />)}
      </nav>
      <div className="flex-grow" />
      {userName && (
        <div className="mb-3 px-2 py-2 border-t border-[var(--color-border)] text-xs">
          <div className="text-slate-300 font-medium truncate">{userName}</div>
          <div className="text-slate-500 truncate">{userEmail}</div>
          {clubName && <div className="text-amber-500 mt-1 truncate">{clubName}</div>}
          {signOutAction && (
            <form action={signOutAction}>
              <button type="submit" className="text-slate-500 hover:text-amber-500 text-xs mt-2">
                Sign out
              </button>
            </form>
          )}
        </div>
      )}
      <nav className="flex flex-col gap-1 pt-3 border-t border-[var(--color-border)]">
        {bottomItems.map((item) => <NavLink key={item.href} item={item} activePath={activePath} />)}
      </nav>
    </aside>
  );
}
