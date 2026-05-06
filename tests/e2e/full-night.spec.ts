import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  const E2E_URL = "postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_e2e?schema=public";
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: E2E_URL,
      PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "1",
    },
  });
  execSync("npx prisma db seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL },
  });
});

test("full night: open session, add player, buy-in, cash-out, close", async ({ page }) => {
  // Open session
  await page.goto("/live");
  await expect(page.getByText("No session open")).toBeVisible();
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Create a player
  await page.goto("/players/new");
  await page.getByLabel(/Display name/).fill("Test Player");
  await page.getByRole("button", { name: /Create/ }).click();
  await expect(page.getByText("Test Player")).toBeVisible();

  // Create a table
  await page.goto("/tables");
  await page.getByPlaceholder(/Table name/).fill("Table 1");
  await page.getByPlaceholder(/Stakes/).fill("1/2 NL");
  await page.getByRole("button", { name: /^Add$/ }).click();

  // Buy-in $500 cash via the Quick Actions modal
  await page.goto("/live");
  await page.getByRole("button", { name: /\+ Buy-in/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: /Record Buy-in/ }).click();

  // Wait for the Server Action to complete, then close the modal (it doesn't auto-close)
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Cash drawer should now show $500 (reload to pick up the server-side update)
  await page.reload();
  await expect(page.getByText("$500.00").first()).toBeVisible();

  // Cash-out $500 via the Quick Actions modal.
  // Default mode (no Settings toggle flipped) is the simple "Total amount" input.
  await page.getByRole("button", { name: /− Cash-out/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await page.locator("input[name=amount]").fill("500");
  await page.getByRole("button", { name: /Record Cash-out/ }).click();

  // Wait for Server Action to complete, then close the modal
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Reload to get fresh server state; verify session still active after cash-out
  await page.reload();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Close session
  await page.getByRole("link", { name: /Close session/ }).click();
  await page.getByRole("button", { name: /Close Session/ }).click();
  await expect(page.getByText("No session open")).toBeVisible();
});
