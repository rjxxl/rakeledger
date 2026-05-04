import type { AccountType } from "@prisma/client";

export const ACCOUNTS: AccountType[] = [
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
  "CHIP_FLOAT", "MARKER_OUTSTANDING",
  "TIP_POOL", "HOUSE_TAX_POOL",
  "RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL",
  "EXTERNAL",
];

export const GAME_SCOPED_ACCOUNTS: AccountType[] = [
  "RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL",
];

const ASSETS: AccountType[] = ["CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "MARKER_OUTSTANDING"];
const LIABILITIES: AccountType[] = ["CHIP_FLOAT", "TIP_POOL", "TOURNAMENT_POOL"];
const REVENUES: AccountType[] = ["RAKE_POOL", "HOUSE_TAX_POOL"];
const EXPENSES: AccountType[] = ["PROMO_POOL"];
const EXTERNALS: AccountType[] = ["EXTERNAL"];

export function naturalSign(account: AccountType): 1 | -1 {
  if (LIABILITIES.includes(account) || REVENUES.includes(account)) return -1;
  if (ASSETS.includes(account) || EXPENSES.includes(account) || EXTERNALS.includes(account)) return 1;
  throw new Error(`Unknown account: ${account}`);
}

export function isGameScoped(account: AccountType): boolean {
  return GAME_SCOPED_ACCOUNTS.includes(account);
}
