import Decimal from "decimal.js";
import type { TransactionType, PaymentMethod, AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createTransaction } from "./transaction";

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionError";
  }
}

const SUPPORTED_TYPES: ReadonlySet<TransactionType> = new Set([
  "BUY_IN", "CASH_OUT", "RAKE", "TIP_DROP",
  "TOURNAMENT_FEE", "TOURNAMENT_PAYOUT",
  "JACKPOT_PAYOUT", "FREEROLL_PRIZE_PAYOUT",
  "STAFF_ADVANCE", "FNB_COST", "DRAWER_COUNT_ADJUST", "CHIP_FLOAT_ADJUST",
]);

const METHOD_TO_ACCOUNT: Record<PaymentMethod, AccountType> = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
  OTHER: "CASH_DRAWER",
  CHIPS: "CASH_DRAWER",
};

const METHOD_DERIVED_ACCOUNTS: ReadonlySet<AccountType> = new Set([
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
]);

export interface CorrectionOverrides {
  method?: PaymentMethod;
  amount?: Decimal;
  playerId?: string | null;
  tableId?: string | null;
  staffId?: string | null;
  note?: string | null;
}

export interface CorrectTransactionArgs {
  originalId: string;
  reversedById: string;
  reason: string;
  overrides: CorrectionOverrides;
}

export async function correctTransaction(args: CorrectTransactionArgs) {
  const original = await prisma.transaction.findUnique({
    where: { id: args.originalId },
    include: { ledgerEntries: true },
  });
  if (!original) throw new CorrectionError(`Transaction ${args.originalId} not found`);
  if (original.reversesId) throw new CorrectionError("Cannot correct a reversal");
  if (!SUPPORTED_TYPES.has(original.type)) {
    throw new CorrectionError(`Type ${original.type} is not supported by the correction tool. Use the dedicated workflow.`);
  }

  const existingReversal = await prisma.transaction.findFirst({ where: { reversesId: args.originalId } });
  if (existingReversal) throw new CorrectionError("This transaction has already been corrected or reversed");

  const originalAmount = new Decimal(original.amount.toString());
  const newAmount = args.overrides.amount ?? originalAmount;
  if (newAmount.lessThanOrEqualTo(0)) throw new CorrectionError("Amount must be greater than zero");

  const scale = newAmount.div(originalAmount);
  const newMethod = args.overrides.method ?? (original.method as PaymentMethod);
  const targetMethodAccount = METHOD_TO_ACCOUNT[newMethod];

  const newEntries = original.ledgerEntries.map((e) => {
    let account = e.account as AccountType;
    if (
      args.overrides.method !== undefined &&
      METHOD_DERIVED_ACCOUNTS.has(account)
    ) {
      account = targetMethodAccount;
    }
    return {
      account,
      delta: new Decimal(e.delta.toString()).mul(scale),
      gameId: e.gameId,
    };
  });

  return await prisma.$transaction(async () => {
    const reversal = await createTransaction({
      sessionId: original.sessionId,
      gameId: original.gameId,
      type: original.type,
      createdById: args.reversedById,
      amount: originalAmount.neg(),
      method: original.method as PaymentMethod,
      playerId: original.playerId,
      staffId: original.staffId,
      tableId: original.tableId,
      reversesId: original.id,
      note: `REVERSAL of ${original.id}: ${args.reason}`,
      entries: original.ledgerEntries.map((e) => ({
        account: e.account as AccountType,
        delta: new Decimal(e.delta.toString()).neg(),
        gameId: e.gameId,
      })),
    });

    const corrected = await createTransaction({
      sessionId: original.sessionId,
      gameId: original.gameId,
      type: original.type,
      createdById: args.reversedById,
      amount: newAmount,
      method: newMethod,
      playerId: args.overrides.playerId !== undefined ? args.overrides.playerId : original.playerId,
      staffId: args.overrides.staffId !== undefined ? args.overrides.staffId : original.staffId,
      tableId: args.overrides.tableId !== undefined ? args.overrides.tableId : original.tableId,
      note: args.overrides.note !== undefined ? args.overrides.note : `Corrected from ${original.id}: ${args.reason}`,
      entries: newEntries,
    });

    return { reversal, corrected };
  });
}
