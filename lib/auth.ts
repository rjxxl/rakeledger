import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";

/**
 * Pure policy: can this email sign in?
 *
 * Rules:
 *  1. Must reference a User row that exists.
 *  2. User.status must be ACTIVE.
 *  3. User must have at least one ClubMembership with status=ACTIVE.
 *
 * Exported for testability. The signIn callback below calls this with the
 * default prisma client.
 */
export async function canSignIn(
  email: string | null | undefined,
  client: PrismaClient = prisma
): Promise<boolean> {
  if (!email) return false;
  const dbUser = await client.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!dbUser) return false;
  if (dbUser.status !== "ACTIVE") return false;
  if (dbUser.memberships.length === 0) return false;
  return true;
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
      return await canSignIn(user.email);
    },
    // TODO(phase-a): Refresh activeClubId/activeClubName on every JWT cycle (or invalidate session
    // on ClubMembership change). Right now we only resolve them on initial sign-in, so a user's
    // session keeps the old clubId for up to 30 days even if their membership is moved/revoked.
    // Documented as best-effort revoke; nuclear option = rotate AUTH_SECRET.
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
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
        throw new Error("Session token is missing dbUserId — refusing to construct session");
      }
      session.user.id = token.dbUserId as string;
      session.user.clubId = (token.activeClubId as string | null) ?? null;
      session.user.clubName = (token.activeClubName as string | null) ?? null;
      return session;
    },
  },
});
