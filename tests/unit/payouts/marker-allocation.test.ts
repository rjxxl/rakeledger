import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  allocateMarkerRepayments,
  type AllocatableMarker,
} from "@/lib/payouts/marker-allocation";

const m = (id: string, remaining: number): AllocatableMarker => ({
  id,
  remaining: new Decimal(remaining),
});

describe("allocateMarkerRepayments", () => {
  it("X > M: full payout of difference, all markers fully repaid", () => {
    const r = allocateMarkerRepayments(new Decimal(500), [m("a", 100), m("b", 50)]);
    expect(r.payout.toString()).toBe("350");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(50) },
    ]);
    expect(r.stillOpen).toEqual([]);
  });

  it("X = M exactly: zero payout, all repaid, nothing still open", () => {
    const r = allocateMarkerRepayments(new Decimal(150), [m("a", 100), m("b", 50)]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(50) },
    ]);
    expect(r.stillOpen).toEqual([]);
  });

  it("X < M single marker: zero payout, partial repayment, remainder still open", () => {
    const r = allocateMarkerRepayments(new Decimal(60), [m("a", 100)]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([{ markerId: "a", amount: new Decimal(60) }]);
    expect(r.stillOpen).toEqual([{ markerId: "a", remaining: new Decimal(40) }]);
  });

  it("X < M multi marker: FIFO oldest fully repaid, next partial, rest untouched", () => {
    const r = allocateMarkerRepayments(new Decimal(120), [
      m("a", 100),
      m("b", 50),
      m("c", 30),
    ]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(20) },
    ]);
    expect(r.stillOpen).toEqual([
      { markerId: "b", remaining: new Decimal(30) },
      { markerId: "c", remaining: new Decimal(30) },
    ]);
  });

  it("no markers: payout is the full chip value, no repayments", () => {
    const r = allocateMarkerRepayments(new Decimal(500), []);
    expect(r.payout.toString()).toBe("500");
    expect(r.repayments).toEqual([]);
    expect(r.stillOpen).toEqual([]);
  });

  it("skips zero-remaining markers without emitting empty repayments", () => {
    const r = allocateMarkerRepayments(new Decimal(500), [m("a", 0), m("b", 100)]);
    expect(r.repayments).toEqual([{ markerId: "b", amount: new Decimal(100) }]);
    expect(r.stillOpen).toEqual([]);
    expect(r.payout.toString()).toBe("400");
  });
});
