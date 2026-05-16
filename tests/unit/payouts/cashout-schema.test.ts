import { describe, it, expect } from "vitest";
import { cashOutSchema } from "@/lib/validation/transactions";

describe("cashOutSchema markerScope", () => {
  const base = { sessionId: "s", gameId: "g", playerId: "p", method: "CASH", amount: "100" };

  it("defaults markerScope to NONE when absent (back-compat)", () => {
    const parsed = cashOutSchema.parse(base);
    expect(parsed.markerScope).toBe("NONE");
  });

  it("accepts ALL and TONIGHT", () => {
    expect(cashOutSchema.parse({ ...base, markerScope: "ALL" }).markerScope).toBe("ALL");
    expect(cashOutSchema.parse({ ...base, markerScope: "TONIGHT" }).markerScope).toBe("TONIGHT");
  });

  it("rejects an unknown scope", () => {
    expect(() => cashOutSchema.parse({ ...base, markerScope: "SOME" })).toThrow();
  });
});
