import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Load test-specific env BEFORE Vitest spawns workers
loadDotenv({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
