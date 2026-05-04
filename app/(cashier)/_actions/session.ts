"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import Decimal from "decimal.js";
import { createTransaction } from "@/lib/ledger/transaction";

const CASHIER_EMAIL = "cashier@dev.local";

async function getCashierUserId(): Promise<string> {
  const cashier = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!cashier) throw new Error("Cashier user not seeded — run `npx prisma db seed`");
  return cashier.id;
}

export async function openSession(formData: FormData): Promise<void> {
  const openingCashRaw = formData.get("openingCash")?.toString() ?? "0";
  const openingCash = new Decimal(openingCashRaw || "0");
  const cashierId = await getCashierUserId();

  const session = await prisma.session.create({
    data: {
      openedById: cashierId,
      openingCash: openingCash.toString(),
    },
  });

  // Auto-create a default Game so all transactions have a gameId
  const game = await prisma.game.create({
    data: {
      sessionId: session.id,
      name: "Main Game",
      rakeSplitConfig: { type: "even" },
    },
  });

  // If openingCash > 0, record an OPENING_FLOAT transaction
  if (openingCash.greaterThan(0)) {
    await createTransaction({
      sessionId: session.id,
      gameId: game.id,
      type: "OPENING_FLOAT",
      createdById: cashierId,
      amount: openingCash,
      method: "CASH",
      note: "Session opening float",
      entries: [
        { account: "CASH_DRAWER", delta: openingCash },
        { account: "EXTERNAL", delta: openingCash.neg() },
      ],
    });
  }

  revalidatePath("/live");
}

export async function getOpenSession() {
  return await prisma.session.findFirst({
    where: { status: "OPEN" },
    include: { games: true, openedBy: true },
    orderBy: { openedAt: "desc" },
  });
}
