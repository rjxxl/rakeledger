"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import { z } from "zod";
import { getCashierUserId } from "./_cashier";

const tipPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  totalTipPool: z.string().regex(/^\d+(\.\d+)?$/),
  roundedTax: z.string().regex(/^\d+(\.\d+)?$/),
  netToStaff: z.string().regex(/^\d+(\.\d+)?$/),
  calculatedTax: z.string().regex(/^\d+(\.\d+)?$/),
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
});

const METHOD_TO_ACCOUNT = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
} as const;

export async function executeTipPayout(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = tipPayoutSchema.parse(obj);

  const sessionId = input.sessionId;
  const gameId = input.gameId;
  const staffId = input.staffId;
  const cashierId = await getCashierUserId();
  const totalTipPool = new Decimal(input.totalTipPool);
  const roundedTax = new Decimal(input.roundedTax);
  const netToStaff = new Decimal(input.netToStaff);
  const calculatedTax = new Decimal(input.calculatedTax);
  const method = input.method;
  const targetAccount = METHOD_TO_ACCOUNT[method];

  if (!roundedTax.add(netToStaff).equals(totalTipPool)) {
    throw new Error(`Tax + net ($${roundedTax} + $${netToStaff}) must equal total tip pool ($${totalTipPool})`);
  }

  if (roundedTax.greaterThan(0)) {
    const roundingAdjustment = roundedTax.sub(calculatedTax);
    await createTransaction({
      sessionId, gameId,
      type: "TIP_HOUSE_TAX",
      createdById: cashierId,
      amount: roundedTax,
      method: "CHIPS",
      staffId,
      roundingAdjustment,
      entries: [
        { account: "TIP_POOL", delta: roundedTax.neg() },
        { account: "HOUSE_TAX_POOL", delta: roundedTax },
      ],
    });
  }

  if (netToStaff.greaterThan(0)) {
    await createTransaction({
      sessionId, gameId,
      type: "TIP_PAYOUT",
      createdById: cashierId,
      amount: netToStaff,
      method,
      staffId,
      entries: [
        { account: targetAccount, delta: netToStaff.neg() },
        { account: "TIP_POOL", delta: netToStaff.neg() },
      ],
    });
  }

  revalidatePath("/close");
}

const distributeRakeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  recipients: z.string(),
});

export async function distributeRakeForGame(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = distributeRakeSchema.parse(obj);
  const recipients = z.array(z.object({
    userId: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
  })).parse(JSON.parse(input.recipients));

  const cashierId = await getCashierUserId();

  for (const r of recipients) {
    const amount = new Decimal(r.amount);
    if (amount.lessThanOrEqualTo(0)) continue;
    const targetAccount = METHOD_TO_ACCOUNT[r.method];

    const tx = await createTransaction({
      sessionId: input.sessionId,
      gameId: input.gameId,
      type: "RAKE_DISTRIBUTION",
      createdById: cashierId,
      amount,
      method: r.method,
      staffId: r.userId,
      entries: [
        { account: targetAccount, delta: amount.neg() },
        { account: "RAKE_POOL", delta: amount.neg(), gameId: input.gameId },
      ],
    });

    await prisma.rakeDistribution.create({
      data: {
        sessionId: input.sessionId,
        gameId: input.gameId,
        recipientUserId: r.userId,
        amount: amount.toString(),
        txId: tx.id,
      },
    });
  }

  revalidatePath("/close");
}

const distributeHouseTaxSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  recipients: z.string(),
});

export async function distributeHouseTax(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = distributeHouseTaxSchema.parse(obj);
  const recipients = z.array(z.object({
    userId: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
  })).parse(JSON.parse(input.recipients));

  const cashierId = await getCashierUserId();

  for (const r of recipients) {
    const amount = new Decimal(r.amount);
    if (amount.lessThanOrEqualTo(0)) continue;
    const targetAccount = METHOD_TO_ACCOUNT[r.method];

    await createTransaction({
      sessionId: input.sessionId,
      gameId: input.gameId,
      type: "HOUSE_TAX_DISTRIBUTION",
      createdById: cashierId,
      amount,
      method: r.method,
      staffId: r.userId,
      entries: [
        { account: targetAccount, delta: amount.neg() },
        { account: "HOUSE_TAX_POOL", delta: amount.neg() },
      ],
    });
  }

  revalidatePath("/close");
}
