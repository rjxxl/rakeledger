import Decimal from "decimal.js";

/** A marker eligible for repayment, reduced to its outstanding balance. */
export interface AllocatableMarker {
  id: string;
  /** amount − repaidAmount; always ≥ 0. */
  remaining: Decimal;
}

export interface MarkerRepayment {
  markerId: string;
  /** Amount to repay against this marker; always > 0. */
  amount: Decimal;
}

export interface MarkerAllocationResult {
  /** chipValue − Σ repayments, floored at 0. */
  payout: Decimal;
  /** One entry per marker that receives a non-zero repayment, in input order. */
  repayments: MarkerRepayment[];
  /** Markers with a positive balance left after allocation, in input order. */
  stillOpen: { markerId: string; remaining: Decimal }[];
}

/**
 * Allocates a player's surrendered chip value against their open markers,
 * oldest-first (FIFO). The caller is responsible for passing `markers`
 * already ordered oldest-first and scoped to the desired set (all open vs.
 * current session only). Pass `[]` to model the "no deduction" case.
 *
 * Pure: no I/O, no Decimal global mutation. Used by both the cash-out modal
 * (display) and the server action (authoritative recompute).
 */
export function allocateMarkerRepayments(
  chipValue: Decimal,
  markers: AllocatableMarker[]
): MarkerAllocationResult {
  let cashLeft = chipValue;
  const repayments: MarkerRepayment[] = [];
  const stillOpen: { markerId: string; remaining: Decimal }[] = [];

  for (const marker of markers) {
    const apply = Decimal.min(cashLeft, marker.remaining);
    if (apply.greaterThan(0)) {
      repayments.push({ markerId: marker.id, amount: apply });
      cashLeft = cashLeft.sub(apply);
    }
    const leftover = marker.remaining.sub(apply);
    if (leftover.greaterThan(0)) {
      stillOpen.push({ markerId: marker.id, remaining: leftover });
    }
  }

  return { payout: cashLeft, repayments, stillOpen };
}
