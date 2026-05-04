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

async function ensureSessionOpen(sessionId: string): Promise<void> {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error("Session not found");
  if (s.status === "CLOSED") {
    throw new Error("Cannot record transactions on a closed session.");
  }
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
  await ensureSessionOpen(sessionId);

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
  await ensureSessionOpen(sessionId);

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
  await ensureSessionOpen(sessionId);
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
  await ensureSessionOpen(sessionId);
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

export async function issueMarker(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const collateral = formData.get("collateral")?.toString() || null;

  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Marker issue requires player and positive amount");
  }
  await ensureSessionOpen(sessionId);
  const cashierId = await cashierUserId();

  const tx = await createTransaction({
    sessionId, gameId, type: "MARKER_ISSUE",
    createdById: cashierId, amount, method: "CHIPS",
    playerId,
    note: collateral ? `Collateral: ${collateral}` : null,
    entries: [
      { account: "MARKER_OUTSTANDING", delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  await prisma.marker.create({
    data: {
      playerId, sessionId,
      issuedTxId: tx.id,
      amount: amount.toString(),
      status: "OPEN",
      collateral,
    },
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}

export async function repayMarker(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const markerId = formData.get("markerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";

  if (!sessionId || !gameId || !markerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Marker repay requires marker and positive amount");
  }
  await ensureSessionOpen(sessionId);
  const marker = await prisma.marker.findUnique({ where: { id: markerId } });
  if (!marker) throw new Error("Marker not found");
  if (marker.status !== "OPEN") throw new Error("Marker is not open");

  // Guard against overpayment — a repayment can never exceed the remaining balance.
  const remaining = new Decimal(marker.amount.toString()).sub(marker.repaidAmount.toString());
  if (amount.greaterThan(remaining)) {
    throw new Error(`Repayment ${amount.toString()} exceeds remaining marker balance ${remaining.toString()}`);
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId, gameId, type: "MARKER_REPAY",
    createdById: cashierId, amount, method,
    playerId: marker.playerId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "MARKER_OUTSTANDING", delta: amount.neg() },
    ],
  });

  const newRepaid = new Decimal(marker.repaidAmount.toString()).add(amount);
  const newStatus = newRepaid.greaterThanOrEqualTo(marker.amount.toString()) ? "REPAID" : "OPEN";
  await prisma.marker.update({
    where: { id: markerId },
    data: { repaidAmount: newRepaid.toString(), status: newStatus },
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}
