"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod } from "@prisma/client";

const CASHIER_EMAIL = "cashier@dev.local";

async function cashierUserId(): Promise<string> {
  const c = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!c) throw new Error("Cashier user not seeded");
  return c.id;
}

const METHOD_TO_ACCOUNT: Record<PaymentMethod, "CASH_DRAWER" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY"> = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
  OTHER: "CASH_DRAWER",
  CHIPS: "CASH_DRAWER",
};

export async function recordBuyIn(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";
  const tableId = formData.get("tableId")?.toString() || null;

  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Missing or invalid buy_in input");
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId, gameId, type: "BUY_IN",
    createdById: cashierId, amount, method, playerId, tableId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  revalidatePath("/live");
}

export async function recordCashOut(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";
  const tableId = formData.get("tableId")?.toString() || null;

  // Denomination grid sums: $100 × n100 + $25 × n25 + $5 × n5 + $1 × n1
  const n100 = parseInt(formData.get("n100")?.toString() ?? "0", 10) || 0;
  const n25 = parseInt(formData.get("n25")?.toString() ?? "0", 10) || 0;
  const n5 = parseInt(formData.get("n5")?.toString() ?? "0", 10) || 0;
  const n1 = parseInt(formData.get("n1")?.toString() ?? "0", 10) || 0;

  const amount = new Decimal(n100 * 100 + n25 * 25 + n5 * 5 + n1);
  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Cash-out requires a positive total");
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId, gameId, type: "CASH_OUT",
    createdById: cashierId, amount, method, playerId, tableId,
    entries: [
      { account: targetAccount, delta: amount.neg() },
      { account: "CHIP_FLOAT", delta: amount.neg() },
    ],
  });

  revalidatePath("/live");
}

export async function recordRake(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const staffId = formData.get("staffId")?.toString() || null;
  const tableId = formData.get("tableId")?.toString() || null;
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");

  if (!sessionId || !gameId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Rake requires a positive amount");
  }
  const cashierId = await cashierUserId();

  await createTransaction({
    sessionId, gameId, type: "RAKE",
    createdById: cashierId, amount, method: "CHIPS",
    staffId, tableId,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "RAKE_POOL", delta: amount, gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordTipDrop(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const staffId = formData.get("staffId")?.toString();
  const tableId = formData.get("tableId")?.toString() || null;
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");

  if (!sessionId || !gameId || !staffId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Tip drop requires a recipient and a positive amount");
  }
  const cashierId = await cashierUserId();

  await createTransaction({
    sessionId, gameId, type: "TIP_DROP",
    createdById: cashierId, amount, method: "CHIPS",
    staffId, tableId,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "TIP_POOL", delta: amount },
    ],
  });

  revalidatePath("/live");
}
