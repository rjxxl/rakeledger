import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/auth/signin", "/auth/error", "/api/auth"];

// Next 16 renamed `middleware.ts` → `proxy.ts`. NextAuth's `auth(handler)`
// returns a middleware-style function; we use it here as the proxy entrypoint.
// The handler does two jobs:
//   1. Forward x-pathname on the REQUEST so server components can read the
//      active path (used by the cashier layout to highlight the active nav item).
//   2. Gate access — anything outside PUBLIC_PATHS requires an authenticated
//      session, otherwise redirect to /auth/signin?callbackUrl=...
export default auth((req) => {
  const { nextUrl } = req;
  const headers = new Headers(req.headers);
  headers.set("x-pathname", nextUrl.pathname);

  // Test/E2E bypass — only honored when explicitly opted in via env var.
  // NEVER set this env var in production.
  if (process.env.AUTH_BYPASS_FOR_TESTS === "1") {
    return NextResponse.next({ request: { headers } });
  }

  const isPublic = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));
  const isAuthenticated = !!req.auth;

  if (isPublic) {
    return NextResponse.next({ request: { headers } });
  }

  if (!isAuthenticated) {
    const signInUrl = new URL("/auth/signin", nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
