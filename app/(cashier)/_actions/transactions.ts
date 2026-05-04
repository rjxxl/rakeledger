"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod } from "@prisma/client";
import {
  buyInSchema, cashOutSchema, rakeSchema, tipDropSchema,
  markerIssueSchema, markerRepaySchema, parseFormData,
} from "@/lib/validation/transactions";

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
  const input = parseFormData(buyInSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "BUY_IN",
    createdById: cashierId,
    amount,
    method: input.method as PaymentMethod,
    playerId: input.playerId,
    tableId: input.tableId ?? null,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  revalidatePath("/live");
}

export async function recordCashOut(formData: FormData): Promise<void> {
  const input = parseFormData(cashOutSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];

  // Denomination grid: $100 × n100 + $25 × n25 + $5 × n5 + $1 × n1
  const amount = new Decimal(input.n100 * 100 + input.n25 * 25 + input.n5 * 5 + input.n1);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CASH_OUT",
    createdById: cashierId,
    amount,
    method: input.method as PaymentMethod,
    playerId: input.playerId,
    tableId: input.tableId ?? null,
    entries: [
      { account: targetAccount, delta: amount.neg() },
      { account: "CHIP_FLOAT", delta: amount.neg() },
    ],
  });

  revalidatePath("/live");
}

export async function recordRake(formData: FormData): Promise<void> {
  const input = parseFormData(rakeSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "RAKE",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    staffId: input.staffId ?? null,
    tableId: input.tableId ?? null,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "RAKE_POOL", delta: amount, gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordTipDrop(formData: FormData): Promise<void> {
  const input = parseFormData(tipDropSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "TIP_DROP",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    staffId: input.staffId,
    tableId: input.tableId ?? null,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "TIP_POOL", delta: amount },
    ],
  });

  revalidatePath("/live");
}

export async function issueMarker(formData: FormData): Promise<void> {
  const input = parseFormData(markerIssueSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const collateral = input.collateral ?? null;

  const tx = await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "MARKER_ISSUE",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note: collateral ? `Collateral: ${collateral}` : null,
    entries: [
      { account: "MARKER_OUTSTANDING", delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  await prisma.marker.create({
    data: {
      playerId: input.playerId,
      sessionId: input.sessionId,
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
  const input = parseFormData(markerRepaySchema, formData);
  await ensureSessionOpen(input.sessionId);

  const marker = await prisma.marker.findUnique({ where: { id: input.markerId } });
  if (!marker) throw new Error("Marker not found");
  if (marker.status !== "OPEN") throw new Error("Marker is not open");

  const amount = new Decimal(input.amount);

  // Guard against overpayment — a repayment can never exceed the remaining balance.
  const remaining = new Decimal(marker.amount.toString()).sub(marker.repaidAmount.toString());
  if (amount.greaterThan(remaining)) {
    throw new Error(`Repayment ${amount.toString()} exceeds remaining marker balance ${remaining.toString()}`);
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "MARKER_REPAY",
    createdById: cashierId,
    amount,
    method: input.method as PaymentMethod,
    playerId: marker.playerId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "MARKER_OUTSTANDING", delta: amount.neg() },
    ],
  });

  const newRepaid = new Decimal(marker.repaidAmount.toString()).add(amount);
  const newStatus = newRepaid.greaterThanOrEqualTo(marker.amount.toString()) ? "REPAID" : "OPEN";
  await prisma.marker.update({
    where: { id: input.markerId },
    data: { repaidAmount: newRepaid.toString(), status: newStatus },
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}
