import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";

export interface TileWithBalance {
  account: AccountType;
  label: string;
  balance: Decimal;
  /** Optional: only present for game-scoped tiles. */
  gameId?: string;
}

/**
 * Accounts that ALWAYS render in the AccountStrip even when their balance is zero.
 * Everything else is hidden when its balance is exactly zero.
 *
 * Rationale: the cashier's primary surfaces (cash drawer, chips on the table, the tip kitty,
 * the rake kitty) should always be visible so the cashier can confirm "yes, books look right"
 * at a glance. Method-specific tiles (Zelle, Venmo, etc) only matter once they have activity.
 * MARKER_OUTSTANDING shows only when there are open markers — visibly cuing the cashier to chase.
 */
export const ALWAYS_SHOW: ReadonlySet<AccountType> = new Set([
  "CASH_DRAWER",
  "CHIP_FLOAT",
  "TIP_POOL",
  "RAKE_POOL",
]);

export function filterTiles(tiles: TileWithBalance[]): TileWithBalance[] {
  return tiles.filter((t) => ALWAYS_SHOW.has(t.account) || !t.balance.equals(0));
}
