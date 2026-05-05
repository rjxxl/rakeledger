"use server";

import { prisma } from "@/lib/db";

const CASHIER_EMAIL = "cashier@dev.local";

/**
 * Returns the implicit cashier user's ID. In Plan 1 the cashier is hardcoded —
 * Plan 2 will replace this with auth-derived user IDs.
 */
export async function getCashierUserId(): Promise<string> {
  const cashier = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!cashier) throw new Error("Cashier user not seeded — run `npx prisma db seed`");
  return cashier.id;
}
