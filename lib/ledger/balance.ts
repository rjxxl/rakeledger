import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isGameScoped } from "./accounts";

interface BalanceArgs {
  account: AccountType;
  sessionId: string;
  gameId?: string;
  asOf?: Date;
}

/**
 * Returns the running balance of an account in a session, optionally scoped to a game,
 * optionally as of a specific timestamp (for time-travel queries).
 */
export async function getAccountBalance(args: BalanceArgs): Promise<Decimal> {
  const { account, sessionId, gameId, asOf } = args;

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      account,
      transaction: {
        sessionId,
        ...(asOf ? { createdAt: { lte: asOf } } : {}),
      },
      ...(isGameScoped(account) && gameId ? { gameId } : {}),
    },
    select: { delta: true },
  });

  return entries.reduce((sum, e) => sum.add(new Decimal(e.delta.toString())), new Decimal(0));
}
