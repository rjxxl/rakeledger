"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";

export async function createTable(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const stakes = formData.get("stakes")?.toString().trim() || null;
  if (!name) throw new Error("Table name required");

  const clubId = await getActiveClubId();
  if (!clubId) throw new Error("No active club — cannot create table");

  await prisma.table.create({ data: { name, stakes, clubId } });
  revalidatePath("/tables");
}

export async function toggleTableActive(formData: FormData) {
  const id = formData.get("id")?.toString();
  if (!id) throw new Error("Invalid table");

  const clubId = await getActiveClubId();
  const t = await prisma.table.findUnique({ where: { id } });
  if (!t) throw new Error("Table not found");
  if (t.clubId !== clubId) throw new Error("Table not in your active club");

  await prisma.table.update({ where: { id }, data: { active: !t.active } });
  revalidatePath("/tables");
}
