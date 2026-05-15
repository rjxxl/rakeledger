"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";

export async function createPlayer(formData: FormData) {
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!displayName) throw new Error("Player name is required");

  const clubId = await getActiveClubId();
  if (!clubId) throw new Error("No active club — cannot create player");

  await prisma.player.create({ data: { displayName, phone, notes, clubId } });
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const id = formData.get("id")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!id || !displayName) throw new Error("Invalid player update");

  // Defense against cross-club edits.
  const clubId = await getActiveClubId();
  const existing = await prisma.player.findUnique({ where: { id } });
  if (!existing || existing.clubId !== clubId) {
    throw new Error("Player not found in your active club");
  }

  await prisma.player.update({ where: { id }, data: { displayName, phone, notes } });
  revalidatePath("/players");
  redirect("/players");
}
