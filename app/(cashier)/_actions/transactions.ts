"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { allocateMarkerRepayments } from "@/lib/payouts/marker-allocation";
import {
  buyInSchema, cashOutSchema, rakeSchema, tipDropSchema,
  markerIssueSchema, markerRepaySchema, parseFormData,
  tournamentFeeSchema, tournamentPayoutSchema, jackpotPayoutSchema,
  freerollPrizeSchema,
  staffAdvanceSchema, fnbCostSchema, drawerAdjustSchema, chipFloatAdjustSchema,
} from "@/lib/validation/transactions";
import { getCashierUserId } from "./_cashier";
import { getActiveClubId } from "@/lib/active-user";

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

  const cashierId = await getCashierUserId();
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

/**
 * Repays a single marker inside an existing DB transaction. Mirrors the
 * status/overpayment logic of `repayMarker`. Used by the marker-aware
 * cash-out path so the CASH_OUT and all MARKER_REPAYs commit atomically.
 */
async function repayMarkerInTx(
  txc: Prisma.TransactionClient,
  args: {
    marker: { id: string; amount: string; repaidAmount: string; playerId: string };
    amount: Decimal;
    method: PaymentMethod;
    sessionId: string;
    gameId: string;
    cashierId: string;
  }
): Promise<void> {
  const remaining = new Decimal(args.marker.amount).sub(args.marker.repaidAmount);
  if (args.amount.greaterThan(remaining)) {
    throw new Error(
      `Repayment ${args.amount.toString()} exceeds remaining marker balance ${remaining.toString()}`
    );
  }
  const targetAccount = METHOD_TO_ACCOUNT[args.method];
  await createTransaction(
    {
      sessionId: args.sessionId,
      gameId: args.gameId,
      type: "MARKER_REPAY",
      createdById: args.cashierId,
      amount: args.amount,
      method: args.method,
      playerId: args.marker.playerId,
      entries: [
        { account: targetAccount, delta: args.amount },
        { account: "MARKER_OUTSTANDING", delta: args.amount.neg() },
      ],
    },
    txc
  );
  const newRepaid = new Decimal(args.marker.repaidAmount).add(args.amount);
  const newStatus = newRepaid.greaterThanOrEqualTo(args.marker.amount) ? "REPAID" : "OPEN";
  // Optimistic concurrency: only mutate if the marker is still in the exact
  // state we snapshotted before the transaction. If a concurrent cash-out or
  // repay touched it, the predicate matches zero rows and we abort the whole
  // $transaction rather than double-spending the marker.
  const updated = await txc.marker.updateMany({
    where: { id: args.marker.id, status: "OPEN", repaidAmount: args.marker.repaidAmount },
    data: { repaidAmount: newRepaid.toString(), status: newStatus },
  });
  if (updated.count !== 1) {
    throw new Error(
      `Marker ${args.marker.id} changed concurrently during cash-out; transaction aborted`
    );
  }
}

export async function recordCashOut(formData: FormData): Promise<void> {
  const input = parseFormData(cashOutSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await getCashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];
  const amount = new Decimal(input.amount);
  const method = input.method as PaymentMethod;

  // No marker deduction → unchanged single-CASH_OUT behavior.
  if (input.markerScope === "NONE") {
    await createTransaction({
      sessionId: input.sessionId,
      gameId: input.gameId,
      type: "CASH_OUT",
      createdById: cashierId,
      amount,
      method,
      playerId: input.playerId,
      tableId: input.tableId ?? null,
      entries: [
        { account: targetAccount, delta: amount.neg() },
        { account: "CHIP_FLOAT", delta: amount.neg() },
      ],
    });
    revalidatePath("/live");
    return;
  }

  // Marker-aware path. Re-fetch markers server-side (never trust the client)
  // club-scoped, oldest-first, filtered to the requested scope.
  const clubId = await getActiveClubId();
  const allOpen = await prisma.marker.findMany({
    where: { playerId: input.playerId, status: "OPEN", clubId },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true, repaidAmount: true, sessionId: true, playerId: true },
  });
  const inScope =
    input.markerScope === "TONIGHT"
      ? allOpen.filter((mk) => mk.sessionId === input.sessionId)
      : allOpen;

  const allocation = allocateMarkerRepayments(
    amount,
    inScope.map((mk) => ({
      id: mk.id,
      remaining: new Decimal(mk.amount.toString()).sub(mk.repaidAmount.toString()),
    }))
  );
  const markerById = new Map(inScope.map((mk) => [mk.id, mk]));

  await prisma.$transaction(async (txc) => {
    // Full chip value leaves the cage; the repays below claw the debt back
    // into the same payment account, netting to the true payout.
    await createTransaction(
      {
        sessionId: input.sessionId,
        gameId: input.gameId,
        type: "CASH_OUT",
        createdById: cashierId,
        amount,
        method,
        playerId: input.playerId,
        tableId: input.tableId ?? null,
        entries: [
          { account: targetAccount, delta: amount.neg() },
          { account: "CHIP_FLOAT", delta: amount.neg() },
        ],
      },
      txc
    );

    for (const repayment of allocation.repayments) {
      const mk = markerById.get(repayment.markerId)!;
      await repayMarkerInTx(txc, {
        marker: {
          id: mk.id,
          amount: mk.amount.toString(),
          repaidAmount: mk.repaidAmount.toString(),
          playerId: mk.playerId,
        },
        amount: repayment.amount,
        method,
        sessionId: input.sessionId,
        gameId: input.gameId,
        cashierId,
      });
    }
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}

export async function recordRake(formData: FormData): Promise<void> {
  const input = parseFormData(rakeSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await getCashierUserId();
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

  const cashierId = await getCashierUserId();
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

  const cashierId = await getCashierUserId();
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

  const session = await prisma.session.findUnique({ where: { id: input.sessionId }, select: { clubId: true } });
  await prisma.marker.create({
    data: {
      playerId: input.playerId,
      sessionId: input.sessionId,
      issuedTxId: tx.id,
      amount: amount.toString(),
      status: "OPEN",
      collateral,
      clubId: session?.clubId ?? null,
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

  const cashierId = await getCashierUserId();
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

export interface OpenMarkerDTO {
  id: string;
  amount: string;
  repaidAmount: string;
  remaining: string;
  sessionId: string;
  issuedAt: string;
  isCurrentSession: boolean;
}

/**
 * Returns the player's OPEN markers, club-scoped, oldest-first. All Decimal
 * fields are stringified so the result is safe to return to a client
 * component. `isCurrentSession` lets the modal filter "tonight only" with no
 * second round-trip.
 */
export async function getOpenMarkersForPlayer(
  playerId: string,
  currentSessionId: string
): Promise<OpenMarkerDTO[]> {
  const clubId = await getActiveClubId();
  if (!clubId) throw new Error("No active club");
  const markers = await prisma.marker.findMany({
    where: { playerId, status: "OPEN", clubId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      repaidAmount: true,
      sessionId: true,
      createdAt: true,
    },
  });
  return markers.map((mk) => {
    const remaining = new Decimal(mk.amount.toString()).sub(mk.repaidAmount.toString());
    return {
      id: mk.id,
      amount: mk.amount.toString(),
      repaidAmount: mk.repaidAmount.toString(),
      remaining: remaining.toString(),
      sessionId: mk.sessionId,
      issuedAt: mk.createdAt.toISOString(),
      isCurrentSession: mk.sessionId === currentSessionId,
    };
  });
}

export async function recordTournamentFee(formData: FormData): Promise<void> {
  const input = parseFormData(tournamentFeeSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await getCashierUserId();
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
  const cashierId = await getCashierUserId();
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
  const cashierId = await getCashierUserId();
  const amount = new Decimal(input.amount);
  const method: PaymentMethod = input.paidIn === "CASH" ? "CASH" : "CHIPS";

  // Jackpots are funded from the game's rake pool. Two payout shapes:
  //   CHIPS path: chips leave the cage to the player (chip_float ↑) AND rake pool drained (rake_pool ↓).
  //               Both deltas same magnitude; signs balance under double-entry rules
  //               (chip_float liability +X cancels rake_pool revenue -X).
  //   CASH path: cash leaves the drawer to the player (cash_drawer ↓) AND rake pool drained (rake_pool ↓).
  //              Both deltas negative — same shape as TIP_PAYOUT (settling a revenue obligation with cash).
  //              cash_drawer asset (-X) cancels rake_pool revenue (-X) under sign-adjusted sum.
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
  const cashierId = await getCashierUserId();
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

/**
 * Returns the total dollar value of freeroll prizes awarded to this player in the current session.
 *
 * NOTE: This is a GROSS total — it does NOT subtract any chips the player has since spent (in buy-ins
 * or cashed out). For the buy-in modal's banner, this is informative ("the player walked into your cage
 * with promo chips on their stack — make sure you're only counting the new cash"), but it is not a true
 * unredeemed balance. A proper net per-player off-premises chip tracker is deferred to Plan 1c.
 */
export async function getTotalFreerollPrizesForPlayer(sessionId: string, playerId: string): Promise<string> {
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
  const cashierId = await getCashierUserId();
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
  const cashierId = await getCashierUserId();
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
  const cashierId = await getCashierUserId();
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
  const cashierId = await getCashierUserId();
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
