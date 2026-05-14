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
    // First sign-in: load DB user + active club into the token.
    // Update trigger: client-side useSession().update({ activeClubId }) calls this with
    //   trigger === "update". We validate the user has an ACTIVE membership at the requested club
    //   before swapping the token's activeClubId/activeClubName. Server is the trust boundary —
    //   the client cannot put themselves into a club they're not a member of.
    //
    // TODO(phase-a): refresh activeClubId/activeClubName on every JWT cycle so revoked memberships
    // become unreachable within one navigation. Today the JWT is rewritten only at sign-in or via
    // explicit update; a revoked user's existing JWT keeps the stale clubId until expiry.
    async jwt({ token, user, trigger, session }) {
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
      if (trigger === "update" && session && typeof session === "object") {
        const requestedClubId = (session as { activeClubId?: unknown }).activeClubId;
        if (typeof requestedClubId === "string" && token.dbUserId) {
          const membership = await prisma.clubMembership.findUnique({
            where: { userId_clubId: { userId: token.dbUserId as string, clubId: requestedClubId } },
            include: { club: true },
          });
          if (membership && membership.status === "ACTIVE") {
            token.activeClubId = membership.clubId;
            token.activeClubName = membership.club.name;
          }
          // Silently ignore invalid switches — the client gets back the existing token unchanged.
          // The switcher UI re-fetches `session` after update() so it'll surface the no-op visually.
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
