"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createTable(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const stakes = formData.get("stakes")?.toString().trim() || null;
  if (!name) throw new Error("Table name required");
  await prisma.table.create({ data: { name, stakes } });
  revalidatePath("/tables");
}

export async function toggleTableActive(formData: FormData) {
  const id = formData.get("id")?.toString();
  if (!id) throw new Error("Invalid table");
  const t = await prisma.table.findUnique({ where: { id } });
  if (!t) throw new Error("Table not found");
  await prisma.table.update({ where: { id }, data: { active: !t.active } });
  revalidatePath("/tables");
}
