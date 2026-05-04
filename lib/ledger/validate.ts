import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";
import { naturalSign } from "./accounts";

export class BalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceError";
  }
}

export interface LedgerEntryInput {
  account: AccountType;
  delta: Decimal;
  gameId?: string | null;
}

/**
 * Validates that a set of ledger entries forms a balanced double-entry transaction.
 * Sum of (delta * naturalSign(account)) must equal 0.
 * Throws BalanceError if invalid.
 */
export function validateBalanced(entries: LedgerEntryInput[]): void {
  if (entries.length < 2) {
    throw new BalanceError(`A transaction requires at least 2 entries; got ${entries.length}`);
  }

  let signedSum = new Decimal(0);
  for (const entry of entries) {
    const adjusted = entry.delta.mul(naturalSign(entry.account));
    signedSum = signedSum.add(adjusted);
  }

  if (!signedSum.equals(0)) {
    const lines = entries.map((e) => `  ${e.account}: ${e.delta.toString()}`).join("\n");
    throw new BalanceError(`Transaction unbalanced (signed sum = ${signedSum.toString()}):\n${lines}`);
  }
}
