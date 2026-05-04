import Decimal from "decimal.js";
import type { TransactionType, PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateBalanced, BalanceError, type LedgerEntryInput } from "./validate";

export class TxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxValidationError";
  }
}

export interface CreateTransactionArgs {
  sessionId: string;
  gameId?: string | null;
  type: TransactionType;
  createdById: string;
  amount: Decimal;
  method: PaymentMethod;
  playerId?: string | null;
  staffId?: string | null;
  tableId?: string | null;
  note?: string | null;
  reversesId?: string | null;
  roundingAdjustment?: Decimal | null;
  entries: LedgerEntryInput[];
}

/**
 * Creates a Transaction with its LedgerEntries in a single DB transaction.
 * Validates double-entry balance before insert. The DB trigger validates again at COMMIT.
 */
export async function createTransaction(args: CreateTransactionArgs) {
  try {
    validateBalanced(args.entries);
  } catch (e) {
    if (e instanceof BalanceError) {
      throw new TxValidationError(e.message);
    }
    throw e;
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        sessionId: args.sessionId,
        gameId: args.gameId ?? null,
        type: args.type,
        createdById: args.createdById,
        amount: args.amount.toString(),
        method: args.method,
        playerId: args.playerId ?? null,
        staffId: args.staffId ?? null,
        tableId: args.tableId ?? null,
        note: args.note ?? null,
        reversesId: args.reversesId ?? null,
        roundingAdjustment: args.roundingAdjustment?.toString() ?? null,
        ledgerEntries: {
          create: args.entries.map((e) => ({
            account: e.account,
            delta: e.delta.toString(),
            gameId: e.gameId ?? null,
          })),
        },
      },
      include: { ledgerEntries: true },
    });

    return created;
  });
}

export interface ReverseTransactionArgs {
  transactionId: string;
  reversedById: string;
  reason: string;
}

export async function reverseTransaction(args: ReverseTransactionArgs) {
  const original = await prisma.transaction.findUnique({
    where: { id: args.transactionId },
    include: { ledgerEntries: true },
  });
  if (!original) {
    throw new TxValidationError(`Transaction ${args.transactionId} not found`);
  }
  if (original.reversesId) {
    throw new TxValidationError(
      `Transaction ${args.transactionId} is already a reversal; can't reverse a reversal`
    );
  }

  const negatedEntries: LedgerEntryInput[] = original.ledgerEntries.map((e) => ({
    account: e.account,
    delta: new Decimal(e.delta.toString()).neg(),
    gameId: e.gameId,
  }));

  return await createTransaction({
    sessionId: original.sessionId,
    gameId: original.gameId,
    type: original.type,
    createdById: args.reversedById,
    amount: new Decimal(original.amount.toString()).neg(),
    method: original.method,
    playerId: original.playerId,
    staffId: original.staffId,
    tableId: original.tableId,
    note: `REVERSAL of ${original.id}: ${args.reason}`,
    reversesId: original.id,
    entries: negatedEntries,
  });
}
