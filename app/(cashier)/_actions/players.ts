"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function createPlayer(formData: FormData) {
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!displayName) throw new Error("Player name is required");
  await prisma.player.create({ data: { displayName, phone, notes } });
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const id = formData.get("id")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!id || !displayName) throw new Error("Invalid player update");
  await prisma.player.update({ where: { id }, data: { displayName, phone, notes } });
  revalidatePath("/players");
  redirect("/players");
}
