import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";

export function isEmailAllowed(email: string | null | undefined, allowList: string | undefined | null): boolean {
  if (!email || !allowList) return false;
  const allowed = allowList.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      clubId: string | null;
      clubName: string | null;
    };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      // Allowlist gate — even if Google OAuth succeeds, we reject any email
      // not on AUTH_ALLOWED_EMAILS.
      if (!isEmailAllowed(user.email, process.env.AUTH_ALLOWED_EMAILS)) {
        return false;
      }
      // Provisioning gate — must have an ACTIVE User row in our DB.
      const dbUser = await prisma.user.findUnique({ where: { email: user.email! } });
      if (!dbUser || dbUser.status !== "ACTIVE") return false;
      return true;
    },
    // TODO(phase-a): Refresh activeClubId/activeClubName on every JWT cycle (or invalidate session
    // on ClubMembership change). Right now we only resolve them on initial sign-in, so a user's
    // session keeps the old clubId for up to 30 days even if their membership is moved/revoked.
    async jwt({ token, user }) {
      // First sign-in: load DB user + active club into the token
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              include: { club: true },
              take: 1,
            },
          },
        });
        if (dbUser) {
          token.dbUserId = dbUser.id;
          const m = dbUser.memberships[0];
          token.activeClubId = m?.clubId ?? null;
          token.activeClubName = m?.club.name ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.dbUserId) {
        // Token didn't get populated (shouldn't happen post-Plan-2c, but defense-in-depth)
        throw new Error("Session token is missing dbUserId — refusing to construct session");
      }
      session.user.id = token.dbUserId as string;
      session.user.clubId = (token.activeClubId as string | null) ?? null;
      session.user.clubName = (token.activeClubName as string | null) ?? null;
      return session;
    },
  },
});
