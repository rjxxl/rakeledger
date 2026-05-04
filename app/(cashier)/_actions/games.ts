"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { z } from "zod";

const openGameSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(60),
  gameType: z.string().nullable().optional(),
  stakes: z.string().nullable().optional(),
  splitType: z.enum(["even"]).default("even"),
});

const closeGameSchema = z.object({
  gameId: z.string().min(1),
});

export async function openGame(formData: FormData): Promise<void> {
  const input = openGameSchema.parse({
    sessionId: formData.get("sessionId")?.toString(),
    name: formData.get("name")?.toString(),
    gameType: formData.get("gameType")?.toString() || null,
    stakes: formData.get("stakes")?.toString() || null,
    splitType: formData.get("splitType")?.toString() || "even",
  });

  const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new Error("Session not found");
  if (session.status !== "OPEN") throw new Error("Cannot add a game to a closed session");

  await prisma.game.create({
    data: {
      sessionId: input.sessionId,
      name: input.name,
      gameType: input.gameType ?? null,
      stakes: input.stakes ?? null,
      rakeSplitConfig: { type: input.splitType },
    },
  });

  revalidatePath("/live");
}

export async function closeGame(formData: FormData): Promise<void> {
  const input = closeGameSchema.parse({
    gameId: formData.get("gameId")?.toString(),
  });

  const game = await prisma.game.findUnique({ where: { id: input.gameId } });
  if (!game) throw new Error("Game not found");
  if (game.status !== "OPEN") throw new Error("Game already closed");

  await prisma.game.update({
    where: { id: input.gameId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidatePath("/live");
}
