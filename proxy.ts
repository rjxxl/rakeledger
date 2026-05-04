import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("x-pathname", req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
