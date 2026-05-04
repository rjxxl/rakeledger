import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  // Forward x-pathname on the REQUEST (so headers() in server components can read it).
  // Setting it on the response would only affect the response back to the client.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
