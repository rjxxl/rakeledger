import { prisma } from "@/lib/db";
import { getActiveUser } from "@/lib/active-user";
import type { ClubMembership } from "@prisma/client";

export class NotAdminError extends Error {
  constructor(message = "OWNER or ADMIN role required") {
    super(message);
    this.name = "NotAdminError";
  }
}

/**
 * Returns the active user's membership in their active club if (and only if)
 * the membership role is OWNER or ADMIN. Throws NotAdminError otherwise.
 *
 * Server-side trust boundary — call at the top of any RBAC-gated server
 * action or page server-component.
 */
export async function requireAdmin(): Promise<ClubMembership> {
  const user = await getActiveUser();
  if (!user.clubId) {
    throw new NotAdminError("No active club");
  }
  const membership = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId: user.id, clubId: user.clubId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new NotAdminError("No active membership");
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new NotAdminError();
  }
  return membership;
}
