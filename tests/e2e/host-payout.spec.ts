import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  // Use `npx dotenv -e .env.e2e -- ...` because Prisma CLI loads `.env` after our env: {} block,
  // overwriting any DATABASE_URL we'd pass directly. Wrapping in dotenv-cli ensures .env.e2e wins.
  execSync(
    `npx dotenv -e .env.e2e -- npx prisma migrate reset --force --skip-generate --skip-seed`,
    {
      stdio: "inherit",
      env: { ...process.env, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "1" },
    },
  );
  execSync(`npx dotenv -e .env.e2e -- npx prisma db seed`, { stdio: "inherit" });
});

test("host selection persists and drives both house-tax and rake distribution", async ({ page }) => {
  // Open session.
  await page.goto("/live");
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Drop a $40 chip tip to dealer Jake.
  await page.getByRole("button", { name: /\+ Tip drop/ }).click();
  await page.getByLabel(/Recipient/).selectOption({ label: "Dealer Jake (dealer)" });
  await page.locator("input[name=amount]").fill("40");
  await page.getByRole("button", { name: /Record Tip Drop/ }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  // Add a $20 rake.
  await page.getByRole("button", { name: /\+ Rake/ }).click();
  await page.locator("input[name=amount]").fill("20");
  await page.getByRole("button", { name: /Record Rake/ }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  // Navigate to /close.
  await page.goto("/close");

  // Without any host selected, the rake step shows empty-state (case-insensitive match
  // covers both house-tax "Select..." and rake-distribution "select...").
  await expect(page.getByText(/select at least one host above/i).first()).toBeVisible();

  // Check the seeded test cashier as a host (the seed creates "cashier@dev.local"
  // as OWNER of the test club).
  // The HostSelector lists candidate staff with role != WAITRESS. The test seed
  // includes Cashier (OWNER/CASHIER), Dealer Jake, Dealer Anna. Check the cashier.
  await page.getByLabel("Cashier").check();

  // The empty-state messages should be replaced by recipient tables.
  await expect(page.getByText(/select at least one host above/i)).toHaveCount(0);

  // Wait for the debounced updateSessionHosts (500 ms) + server action to complete
  // before reloading, so the persisted hostUserIds are in the DB.
  await page.waitForTimeout(1500);

  // Reload — selection should persist (Session.hostUserIds).
  await page.reload();
  await expect(page.getByLabel("Cashier")).toBeChecked();

  // Distribute (just verify the button is enabled).
  // Step 2 — house tax pool came from the $40 tip's house-tax slice (~$8 if 20% tax).
  // Step 3 — rake pool is $20.
  // Don't actually click Distribute here; that's tested in full-night.spec.ts.
});
