"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

export async function createStaff(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString() as UserRole;
  const tipTaxRateStr = formData.get("tipTaxRate")?.toString().trim();
  const useDefaultTax = formData.get("useDefaultTax") === "on";

  if (!name) throw new Error("Name required");
  if (!["DEALER", "WAITRESS", "RUNNER"].includes(role)) {
    throw new Error("Role must be DEALER, WAITRESS, or RUNNER");
  }
  const tipTaxRate = useDefaultTax || !tipTaxRateStr
    ? null
    : (parseFloat(tipTaxRateStr) / 100).toString();

  await prisma.user.create({
    data: { name, role, status: "ACTIVE", tipTaxRate },
  });
  revalidatePath("/staff");
  redirect("/staff");
}

export async function updateStaff(formData: FormData) {
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString() as UserRole;
  const tipTaxRateStr = formData.get("tipTaxRate")?.toString().trim();
  const useDefaultTax = formData.get("useDefaultTax") === "on";

  if (!id || !name) throw new Error("Invalid staff update");
  const tipTaxRate = useDefaultTax || !tipTaxRateStr
    ? null
    : (parseFloat(tipTaxRateStr) / 100).toString();

  await prisma.user.update({
    where: { id },
    data: { name, role, tipTaxRate },
  });
  revalidatePath("/staff");
  redirect("/staff");
}
