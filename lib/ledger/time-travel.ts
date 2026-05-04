import { getAccountBalance } from "./balance";
import type { AccountType } from "@prisma/client";

interface TimeTravelArgs {
  account: AccountType;
  sessionId: string;
  gameId?: string;
  asOf: Date;
}

/**
 * Returns the balance of an account as of a specific point in time.
 * Named alias for getAccountBalance with a required asOf param — makes
 * time-travel intent explicit at call sites.
 */
export async function getBalanceAt(args: TimeTravelArgs) {
  return getAccountBalance(args);
}
