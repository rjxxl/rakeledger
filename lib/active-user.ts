import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Returns the currently signed-in User row from the DB, plus their active Club.
 * Throws NotAuthenticatedError if no session.
 *
 * When `process.env.AUTH_BYPASS_FOR_TESTS === "1"`, falls back to looking up
 * `process.env.TEST_USER_EMAIL` (default "test-cashier@dev"). This explicit gate
 * is set in `.env.test` (vitest) and `.env.e2e` (Playwright dev server) and is
 * NEVER set in production. Most vitest tests use `createTransaction` directly
 * with `createdById: "test-cashier"` and don't hit this path.
 */
export async function getActiveUser() {
  if (process.env.AUTH_BYPASS_FOR_TESTS === "1") {
    const email = process.env.TEST_USER_EMAIL ?? "test-cashier@dev";
    const user = await prisma.user.findUnique({
      where: { email },
      include: { club: true },
    });
    if (!user) throw new NotAuthenticatedError();
    return user;
  }

  const session = await auth();
  if (!session?.user?.email) throw new NotAuthenticatedError();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { club: true },
  });
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** Convenience: just the user id. Drop-in replacement for getCashierUserId(). */
export async function getActiveUserId(): Promise<string> {
  const user = await getActiveUser();
  return user.id;
}

/** Convenience: just the active club id. Returns null if user has no membership yet. */
export async function getActiveClubId(): Promise<string | null> {
  const user = await getActiveUser();
  return user.clubId;
}
