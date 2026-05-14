"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * Wraps the app with NextAuth's <SessionProvider> so client components can call
 * useSession() — needed for the club switcher's `update()` call.
 *
 * The `session` prop is pre-fetched server-side and passed in, so the first
 * client render already has the session and doesn't have to refetch.
 */
export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
