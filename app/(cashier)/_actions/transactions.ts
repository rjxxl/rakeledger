"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod } from "@prisma/client";
import {
  buyInSchema, cashOutSchema, rakeSchema, tipDropSchema,
  markerIssueSchema, markerRepaySchema, parseFormData,
  tournamentFeeSchema, tournamentPayoutSchema, jackpotPayoutSchema,
  freerollPrizeSchema,
  staffAdvanceSchema, fnbCostSchema, drawerAdjustSchema, chipFloatAdjustSchema,
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

export async function recordTournamentFee(formData: FormData): Promise<void> {
  const input = parseFormData(tournamentFeeSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "TOURNAMENT_FEE",
    createdById: cashierId,
    amount,
    method: input.method as PaymentMethod,
    playerId: input.playerId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "TOURNAMENT_POOL", delta: amount, gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordTournamentPayout(formData: FormData): Promise<void> {
  const input = parseFormData(tournamentPayoutSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "TOURNAMENT_PAYOUT",
    createdById: cashierId,
    amount,
    method: input.method as PaymentMethod,
    playerId: input.playerId,
    entries: [
      { account: targetAccount, delta: amount.neg() },
      { account: "TOURNAMENT_POOL", delta: amount.neg(), gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordJackpotPayout(formData: FormData): Promise<void> {
  const input = parseFormData(jackpotPayoutSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const method: PaymentMethod = input.paidIn === "CASH" ? "CASH" : "CHIPS";

  const entries =
    input.paidIn === "CHIPS"
      ? [
          { account: "CHIP_FLOAT" as const, delta: amount },
          { account: "RAKE_POOL" as const, delta: amount.neg(), gameId: input.gameId },
        ]
      : [
          { account: "CASH_DRAWER" as const, delta: amount.neg() },
          { account: "RAKE_POOL" as const, delta: amount.neg(), gameId: input.gameId },
        ];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "JACKPOT_PAYOUT",
    createdById: cashierId,
    amount,
    method,
    playerId: input.playerId,
    note: `Jackpot: ${input.reason}`,
    entries,
  });

  revalidatePath("/live");
}

export async function recordFreerollPrize(formData: FormData): Promise<void> {
  const input = parseFormData(freerollPrizeSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "FREEROLL_PRIZE_PAYOUT",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note: input.freerollName ? `Freeroll: ${input.freerollName}` : "Freeroll prize",
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "PROMO_POOL", delta: amount, gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function getUnredeemedPromoForPlayer(sessionId: string, playerId: string): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: {
      sessionId,
      playerId,
      type: "FREEROLL_PRIZE_PAYOUT",
    },
    select: { amount: true },
  });
  const total = txs.reduce(
    (sum, t) => sum.add(new Decimal(t.amount.toString())),
    new Decimal(0)
  );
  return total.toString();
}

export async function recordStaffAdvance(formData: FormData): Promise<void> {
  const input = parseFormData(staffAdvanceSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "STAFF_ADVANCE",
    createdById: cashierId,
    amount,
    method: "CASH",
    staffId: input.staffId,
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount },
    ],
  });
  revalidatePath("/live");
}

export async function recordFnbCost(formData: FormData): Promise<void> {
  const input = parseFormData(fnbCostSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "FNB_COST",
    createdById: cashierId,
    amount,
    method: "CASH",
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount },
    ],
  });
  revalidatePath("/live");
}

export async function recordDrawerAdjust(formData: FormData): Promise<void> {
  const input = parseFormData(drawerAdjustSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "DRAWER_COUNT_ADJUST",
    createdById: cashierId,
    amount: amount.abs(),
    method: "CASH",
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount },
      { account: "EXTERNAL", delta: amount.neg() },
    ],
  });
  revalidatePath("/live");
}

export async function recordChipFloatAdjust(formData: FormData): Promise<void> {
  const input = parseFormData(chipFloatAdjustSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  // CHIP_FLOAT (liability, naturalSign=-1) delta=amount
  // EXTERNAL (external, naturalSign=+1) delta=amount
  // Balance: amount*(-1) + amount*(+1) = 0 ✓
  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CHIP_FLOAT_ADJUST",
    createdById: cashierId,
    amount: amount.abs(),
    method: "CHIPS",
    note: input.note,
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "EXTERNAL", delta: amount },
    ],
  });
  revalidatePath("/live");
}
