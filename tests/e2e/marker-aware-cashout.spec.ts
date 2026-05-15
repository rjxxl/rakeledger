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

test("marker-aware cash-out: receipt deducts the marker and the server repays it", async ({ page }) => {
  // Open session
  await page.goto("/live");
  await expect(page.getByText("No session open")).toBeVisible();
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Create a player
  await page.goto("/players/new");
  await page.getByLabel(/Display name/).fill("Marker Player");
  await page.getByRole("button", { name: /Create/ }).click();
  await expect(page.getByText("Marker Player")).toBeVisible();

  // Buy-in $500 cash so the cage has chips
  await page.goto("/live");
  await page.getByRole("button", { name: /\+ Buy-in/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "Marker Player" });
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: /Record Buy-in/ }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Issue a $200 marker to the player (only the Issue form is present —
  // there are no open markers yet, so the Repay side shows an empty state).
  await page.getByRole("button", { name: /\$ Marker/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "Marker Player" });
  await page.locator("input[name=amount]").fill("200");
  await page.getByRole("button", { name: /^Issue$/ }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Open Cash-out, select the player. Default scope is "All open markers".
  await page.getByRole("button", { name: /− Cash-out/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "Marker Player" });
  await page.locator("input[name=amount]").fill("500");

  // The receipt fetches the player's open markers via a server action; wait
  // for the itemized "Marker (tonight)" deduction line to render.
  await expect(page.getByText(/Marker \(tonight\)/)).toBeVisible();
  await expect(page.getByText("Chips turned in")).toBeVisible();
  await expect(page.getByText("Payout to player")).toBeVisible();
  // $500 chips − $200 marker = $300 payout, reflected in the submit label.
  const submit = page.getByRole("button", { name: /Pay out \$300\.00/ });
  await expect(submit).toBeVisible();
  await submit.click();

  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Server authoritatively repaid the marker: reopening the Marker modal,
  // the Repay side now reports no open markers (the $200 was fully cleared).
  await page.reload();
  await page.getByRole("button", { name: /\$ Marker/ }).click();
  await expect(page.getByText(/No open markers to repay/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Session remains active; close it cleanly.
  await page.reload();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();
  await page.getByRole("link", { name: /Close session/ }).click();
  await page.getByRole("button", { name: /Close Session/ }).click();
  await expect(page.getByText("No session open")).toBeVisible();
});
