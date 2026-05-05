import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // E2E tests run against the isolated rakeledger_e2e database — run serially to avoid races.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npx dotenv -e .env.e2e -- npm run dev",
    port: 3000,
    reuseExistingServer: false, // Always start a fresh server with the e2e DB
    timeout: 60_000,
  },
});
