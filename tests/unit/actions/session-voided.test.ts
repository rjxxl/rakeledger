import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

describe("SessionStatus VOIDED enum", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a session can be created with status VOIDED", async () => {
    const s = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    expect(s.status).toBe("VOIDED");
  });
});
