"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveUser } from "@/lib/active-user";
import { revalidatePath } from "next/cache";

const userIdsSchema = z.array(z.string().min(1));

export async function updateSessionHosts(
  sessionId: string,
  userIds: string[]
): Promise<void> {
  const validatedIds = userIdsSchema.parse(userIds);

  const caller = await getActiveUser();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true, status: true },
  });
  if (!session) throw new Error(`No session with id "${sessionId}"`);
  if (session.clubId !== caller.clubId) {
    throw new Error("Session belongs to a different club");
  }

  if (validatedIds.length > 0) {
    const validUsers = await prisma.user.findMany({
      where: {
        id: { in: validatedIds },
        clubId: session.clubId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (validUsers.length !== validatedIds.length) {
      throw new Error(
        "One or more userIds do not belong to this club or are not ACTIVE"
      );
    }
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { hostUserIds: validatedIds },
  });

  revalidatePath("/close");
}
