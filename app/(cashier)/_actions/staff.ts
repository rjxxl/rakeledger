"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

// Convert an entered "tip tax rate" percentage string (e.g. "15") into a stored
// decimal rate string (e.g. "0.15"). Uses decimal.js to avoid the JS-float
// precision issue where parseFloat("30") / 100 = 0.30000000000000004.
function tipTaxRateFromPercentage(useDefault: boolean, rawPercentage: string | undefined): string | null {
  if (useDefault || !rawPercentage) return null;
  return new Decimal(rawPercentage).div(100).toString();
}

export async function createStaff(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString() as UserRole;
  const tipTaxRateStr = formData.get("tipTaxRate")?.toString().trim();
  const useDefaultTax = formData.get("useDefaultTax") === "on";

  if (!name) throw new Error("Name required");
  if (!["DEALER", "WAITRESS", "RUNNER"].includes(role)) {
    throw new Error("Role must be DEALER, WAITRESS, or RUNNER");
  }
  const tipTaxRate = tipTaxRateFromPercentage(useDefaultTax, tipTaxRateStr);

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
  const tipTaxRate = tipTaxRateFromPercentage(useDefaultTax, tipTaxRateStr);

  await prisma.user.update({
    where: { id },
    data: { name, role, tipTaxRate },
  });
  revalidatePath("/staff");
  redirect("/staff");
}
