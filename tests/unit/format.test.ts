import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { formatMoney, formatMoneySigned } from "@/lib/format";

describe("formatMoney", () => {
  it("formats with two decimals and thousands separators", () => {
    expect(formatMoney(new Decimal(1234.5))).toBe("$1,234.50");
  });
  it("preserves negative sign", () => {
    expect(formatMoney(new Decimal(-200))).toBe("-$200.00");
  });
  it("formats zero", () => {
    expect(formatMoney(new Decimal(0))).toBe("$0.00");
  });
});

describe("formatMoneySigned", () => {
  it("adds + for positive", () => {
    expect(formatMoneySigned(new Decimal(50))).toBe("+$50.00");
  });
  it("preserves negative", () => {
    expect(formatMoneySigned(new Decimal(-50))).toBe("-$50.00");
  });
  it("does not add + for zero", () => {
    expect(formatMoneySigned(new Decimal(0))).toBe("$0.00");
  });
});
