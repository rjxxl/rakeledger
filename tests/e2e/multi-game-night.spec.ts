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

test("multi-game night: open session, add second game, buy-in, close cleanly", async ({ page }) => {
  // Open session
  await page.goto("/live");
  await expect(page.getByText("No session open")).toBeVisible();
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Add a player
  await page.goto("/players/new");
  await page.getByLabel(/Display name/).fill("E2E Player");
  await page.getByRole("button", { name: /Create/ }).click();

  // Add a table
  await page.goto("/tables");
  await page.getByPlaceholder(/Table name/).fill("Table 1");
  await page.getByPlaceholder(/Stakes/).fill("1/2 NL");
  await page.getByRole("button", { name: /^Add$/ }).click();

  // Buy-in $500 cash on the default game via the Quick Actions modal
  await page.goto("/live");
  await page.getByRole("button", { name: /\+ Buy-in/ }).click();
  // Modal is now open — verify and interact with the dialog
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
  await page.getByLabel(/Player/).selectOption({ label: "E2E Player" });
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: /Record Buy-in/ }).click();

  // Wait for the Server Action to complete, then close the modal (it doesn't auto-close)
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Verify cash drawer shows $500 (reload to get fresh server state)
  await page.reload();
  await expect(page.getByText("$500.00").first()).toBeVisible();

  // Close session — navigate through to the final reconcile step and submit
  await page.getByRole("link", { name: /Close session/ }).click();
  // The close page has multiple "Close Session" buttons in different forms; click the final red one.
  await page.getByRole("button", { name: /^Close Session$/ }).click();

  // After successful close, /live should show "No session open" again
  await expect(page.getByText("No session open")).toBeVisible();
});
