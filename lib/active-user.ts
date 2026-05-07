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
 * In tests (process.env.NODE_ENV === "test"), falls back to looking up
 * `process.env.TEST_USER_EMAIL` (default "test-cashier@dev"). Most tests use
 * `createTransaction` directly with `createdById: "test-cashier"` and don't hit this path.
 */
export async function getActiveUser() {
  if (process.env.NODE_ENV === "test") {
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
