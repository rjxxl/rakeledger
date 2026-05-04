import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  // Reset and reseed before each test
  const consentEnv = {
    ...process.env,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
      "yes, reset the local dev database before each E2E test",
  };
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", {
    stdio: "inherit",
    env: consentEnv,
  });
  execSync("npx prisma db seed", { stdio: "inherit" });
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

  // Buy-in $500 cash
  await page.goto("/live");
  const buyInForm = page.locator("form").filter({ hasText: "+ Buy-in" });
  await buyInForm.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await buyInForm.getByLabel(/Amount/).fill("500");
  await buyInForm.getByRole("button", { name: /Record Buy-in/ }).click();

  // Cash drawer should now show $500
  await expect(page.getByText("$500.00").first()).toBeVisible();

  // Cash-out $500 (5 × $100)
  const cashOutForm = page.locator("form").filter({ hasText: "− Cash-out" });
  await cashOutForm.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await cashOutForm.locator("input[name=n100]").fill("5");
  await cashOutForm.getByRole("button", { name: /Record Cash-out/ }).click();

  // Cash drawer back to $0
  await page.waitForTimeout(500);
  await expect(page.locator("text=Cash drawer").locator("xpath=./following-sibling::*")).toContainText("$0.00");

  // Close session
  await page.getByRole("link", { name: /Close session/ }).click();
  await page.getByRole("button", { name: /Close Session/ }).click();
  await expect(page.getByText("No session open")).toBeVisible();
});
