import Decimal from "decimal.js";

/**
 * Splits `total` evenly across `count` recipients with 2-decimal rounding,
 * placing any remainder on the first recipient. Returns an empty array when
 * count is 0.
 */
export function evenSplit(total: Decimal, count: number): Decimal[] {
  if (count === 0) return [];
  const baseDecimal = total.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const totals: Decimal[] = Array(count).fill(baseDecimal);
  const allocated = baseDecimal.mul(count);
  const remainder = total.sub(allocated);
  if (!remainder.equals(0) && totals.length > 0) {
    totals[0] = totals[0].add(remainder);
  }
  return totals;
}
