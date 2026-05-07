import { describe, it, expect } from "vitest";
import { isEmailAllowed } from "@/lib/auth";

describe("isEmailAllowed", () => {
  it("returns true for an exact match in a single-entry allowlist", () => {
    expect(isEmailAllowed("alice@example.com", "alice@example.com")).toBe(true);
  });

  it("returns true for any of multiple comma-separated entries", () => {
    const list = "alice@example.com, bob@example.com,carol@example.com";
    expect(isEmailAllowed("bob@example.com", list)).toBe(true);
    expect(isEmailAllowed("carol@example.com", list)).toBe(true);
  });

  it("trims whitespace around entries", () => {
    expect(isEmailAllowed("alice@example.com", "  alice@example.com  ,bob@example.com")).toBe(true);
  });

  it("is case-insensitive on the email", () => {
    expect(isEmailAllowed("ALICE@example.com", "alice@example.com")).toBe(true);
    expect(isEmailAllowed("alice@example.com", "ALICE@EXAMPLE.COM")).toBe(true);
  });

  it("returns false for an email not on the list", () => {
    expect(isEmailAllowed("eve@example.com", "alice@example.com,bob@example.com")).toBe(false);
  });

  it("returns false for null/empty inputs", () => {
    expect(isEmailAllowed(null, "alice@example.com")).toBe(false);
    expect(isEmailAllowed("", "alice@example.com")).toBe(false);
    expect(isEmailAllowed("alice@example.com", "")).toBe(false);
    expect(isEmailAllowed("alice@example.com", undefined)).toBe(false);
  });
});
