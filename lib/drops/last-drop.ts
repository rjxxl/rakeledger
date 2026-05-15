import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import type { TransactionType } from "@prisma/client";

export interface DropTrackerEntry {
  staffId: string;
  staffName: string;
  staffRole: "DEALER" | "WAITRESS";
  lastRakeDrop: Date | null;
  lastTipDrop: Date | null;
}

const DROP_TYPES: TransactionType[] = ["RAKE", "TIP_DROP"];

/** For each active dealer/waitress, returns the most recent rake-drop and tip-drop times in this session. */
export async function getDropTracker(sessionId: string): Promise<DropTrackerEntry[]> {
  const clubId = await getActiveClubId();
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE", clubId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  const drops = await prisma.transaction.findMany({
    where: { sessionId, type: { in: DROP_TYPES }, staffId: { not: null } },
    select: { staffId: true, type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return staff.map((s) => {
    const lastRake = drops.find((d) => d.staffId === s.id && d.type === "RAKE")?.createdAt ?? null;
    const lastTip = drops.find((d) => d.staffId === s.id && d.type === "TIP_DROP")?.createdAt ?? null;
    return {
      staffId: s.id,
      staffName: s.name,
      staffRole: s.role as "DEALER" | "WAITRESS",
      lastRakeDrop: lastRake,
      lastTipDrop: lastTip,
    };
  });
}
